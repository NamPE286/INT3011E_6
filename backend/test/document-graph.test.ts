import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { buildDocumentGraph, getDocumentRelations, maskQuotedText } from "../src/modules/documents/document-graph.service";
import { buildCorpusIndex, resolveCandidate } from "../src/modules/documents/document-graph.resolver";
import type { DocumentMetadata } from "../src/modules/documents/document-metadata";
import { parseVietnameseDate, readDocumentMetadata } from "../src/modules/documents/document-metadata";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

function metadata(documentId: string, documentNumber: string, documentType: string | null, issuedAt: string | null = null): DocumentMetadata {
    return {
        documentId,
        documentNumber,
        normalizedNumber: documentNumber.toLowerCase().replace(/đ/g, "d").replace(/[-_./]+/g, "/"),
        documentType,
        agency: null,
        issuedAt,
        effectiveFrom: null,
        effectiveEvidence: null,
        metadataNotes: [],
    };
}

describe("buildDocumentGraph", () => {
    it("keeps a target outside the corpus unresolved, then accepts it once the target is imported", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await storeLegalDocument(db, AMENDING_DECREE);
        await buildDocumentGraph(db, AMENDING_DECREE.id);

        const before = await getDocumentRelations(db, AMENDING_DECREE.id);

        expect(before.outgoing).toHaveLength(0);
        expect(before.coverage.frontier).toContain("100/2019/NĐ-CP");

        await storeLegalDocument(db, BASE_DECREE);
        await buildDocumentGraph(db, BASE_DECREE.id);

        const base = await getDocumentRelations(db, BASE_DECREE.id);
        const incoming = base.incoming.find((edge) => edge.otherDocumentId === AMENDING_DECREE.id);

        expect(incoming).toMatchObject({ relationType: "AMENDS_OR_SUPPLEMENTS", scope: "PARTIAL", evidenceLevel: "EXPLICIT_LEGAL_TEXT" });
        expect(incoming?.evidence[0]).toMatchObject({
            sourceProvisionId: `${AMENDING_DECREE.id}:dieu_2`,
            evidenceField: "PROVISION_TITLE",
            status: "ACCEPTED",
        });
        expect(incoming?.evidence[0].quotedText).toStartWith("Sửa đổi, bổ sung một số điều của Nghị định số 100/2019/NĐ-CP");
    });

    it("reads the expiry clause as a repeal of a document that is outside the corpus", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await storeLegalDocument(db, BASE_DECREE);
        await buildDocumentGraph(db, BASE_DECREE.id);

        const view = await getDocumentRelations(db, BASE_DECREE.id);
        const repeal = view.candidates.find((candidate) => candidate.targetDocumentNumber === "46/2016/NĐ-CP");

        expect(repeal).toMatchObject({ proposedRelationType: "FULLY_REPEALS", status: "UNRESOLVED" });
        expect(view.metadata).toMatchObject({ documentNumber: "100/2019/NĐ-CP", effectiveFrom: "2020-01-01", issuedAt: "2019-12-30" });
    });

    it("ignores citations inside quoted new text", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await storeLegalDocument(db, AMENDING_DECREE);
        await buildDocumentGraph(db, AMENDING_DECREE.id);

        const view = await getDocumentRelations(db, AMENDING_DECREE.id);

        expect(view.candidates.some((candidate) => candidate.targetDocumentNumber === "46/2016/NĐ-CP")).toBe(false);
    });

    it("drops the graph of a document that now needs review", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });

        await storeLegalDocument(db, BASE_DECREE);
        await storeLegalDocument(db, AMENDING_DECREE);
        await buildDocumentGraph(db, BASE_DECREE.id);
        await buildDocumentGraph(db, AMENDING_DECREE.id);
        await db.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED' WHERE id = ?").bind(AMENDING_DECREE.id).run();

        expect((await buildDocumentGraph(db, AMENDING_DECREE.id)).outcome).toBe("REVIEW_REQUIRED");
        expect((await getDocumentRelations(db, BASE_DECREE.id)).incoming).toHaveLength(0);
    });
});

describe("resolveCandidate", () => {
    const amendment = {
        sourceDocumentId: "source",
        rawTargetCitation: "Nghị định số 100/2019/NĐ-CP",
        targetDocumentNumber: "100/2019/NĐ-CP",
        proposedRelationType: "AMENDS" as const,
    };

    it("accepts only when number and document type agree", () => {
        const corpus = buildCorpusIndex([metadata("target", "100/2019/NĐ-CP", "Nghị định")]);

        expect(resolveCandidate(amendment, corpus)).toMatchObject({ status: "ACCEPTED", resolvedTargetDocumentId: "target" });
    });

    it("keeps a type mismatch as a conflict instead of choosing", () => {
        const corpus = buildCorpusIndex([metadata("target", "100/2019/NĐ-CP", "Thông tư")]);

        expect(resolveCandidate(amendment, corpus).status).toBe("CONFLICT");
    });

    it("reports ambiguity when several stored documents share the number", () => {
        const corpus = buildCorpusIndex([metadata("a", "100/2019/NĐ-CP", "Nghị định"), metadata("b", "100/2019/NĐ-CP", "Nghị định")]);

        expect(resolveCandidate(amendment, corpus)).toMatchObject({ status: "AMBIGUOUS", resolvedTargetDocumentId: null });
    });

    it("rejects a citation that resolves to the source itself", () => {
        const corpus = buildCorpusIndex([metadata("source", "100/2019/NĐ-CP", "Nghị định")]);

        expect(resolveCandidate(amendment, corpus).status).toBe("REJECTED");
    });

    it("does not accept an action whose scope the wording leaves unknown", () => {
        const corpus = buildCorpusIndex([metadata("target", "100/2019/NĐ-CP", "Nghị định")]);

        expect(resolveCandidate({ ...amendment, proposedRelationType: "UNKNOWN" }, corpus).status).toBe("CANDIDATE");
    });

    it("flags a cited issue date that contradicts the stored one", () => {
        const corpus = buildCorpusIndex([metadata("target", "100/2019/NĐ-CP", "Nghị định", "2019-12-30")]);
        const cited = { ...amendment, rawTargetCitation: "Nghị định số 100/2019/NĐ-CP ngày 01 tháng 01 năm 2019" };

        expect(resolveCandidate(cited, corpus).status).toBe("CONFLICT");
    });
});

describe("document metadata helpers", () => {
    it("parses Vietnamese and numeric dates", () => {
        expect(parseVietnameseDate("ngày 5 tháng 7 năm 2024")).toBe("2024-07-05");
        expect(parseVietnameseDate("ngày 01/01/2020")).toBe("2020-01-01");
        expect(parseVietnameseDate("ngày ký")).toBeNull();
    });

    it("does not guess an effective date from 'kể từ ngày ký'", () => {
        const result = readDocumentMetadata({
            documentId: "d",
            title: "NGHỊ ĐỊNH",
            jsonContent: "{}",
            provisionTexts: ["Nghị định này có hiệu lực thi hành kể từ ngày ký."],
        });

        expect(result.effectiveFrom).toBeNull();
    });

    it("blanks quoted text without moving offsets", () => {
        const text = "Thay cụm từ “Nghị định 100” bằng “Nghị định 123”.";

        expect(maskQuotedText(text)).toHaveLength(text.length);
        expect(maskQuotedText(text)).not.toContain("Nghị định");
    });
});

describe("document relation endpoints", () => {
    it("returns 404 for an unknown document", async () => {
        const env = createMockEnv();
        const response = await app.fetch(withEnv(new Request("http://localhost/api/documents/missing/relations"), env));

        expect(response.status).toBe(404);
    });

    it("rebuilds and returns the relations of a stored document", async () => {
        const env = createMockEnv();

        await storeLegalDocument(env.DB, BASE_DECREE);

        const rebuild = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${BASE_DECREE.id}/relations/rebuild`, { method: "POST" }), env));
        const view = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${BASE_DECREE.id}/relations`), env));
        const body = (await view.json()) as { disclaimer: string; coverage: { frontier: string[] } };

        expect(rebuild.status).toBe(200);
        expect(view.status).toBe(200);
        expect(body.coverage.frontier).toContain("46/2016/NĐ-CP");
        expect(body.disclaimer).toContain("does not prove");
    });

    it("refuses to rebuild a document that needs review", async () => {
        const env = createMockEnv();

        await storeLegalDocument(env.DB, { ...BASE_DECREE, reviewStatus: "REVIEW_REQUIRED" });

        const response = await app.fetch(withEnv(new Request(`http://localhost/api/documents/${BASE_DECREE.id}/relations/rebuild`, { method: "POST" }), env));

        expect(response.status).toBe(409);
    });
});
