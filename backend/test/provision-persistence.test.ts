import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { analyzeLegalDocument } from "../src/modules/provisions/provision.analyzer";
import { listProvisions, replaceProvisions } from "../src/modules/provisions/provision.repository";
import { analyzeStoredDocument, findDocumentIdByJobId } from "../src/modules/provisions/provision.service";
import { createTestD1Database } from "./d1-test-db";

const SEED_JOB_ID = "job-seed-nd100";
const SEED_DOCUMENT_ID = "doc-seed-nd100";

async function countProvisions(db: D1Database, documentId: string): Promise<number> {
    const row = await db
        .prepare("SELECT COUNT(*) AS total FROM provisions WHERE document_id = ?")
        .bind(documentId)
        .first<{ total: number }>();

    return row?.total ?? 0;
}

describe("analyzeStoredDocument", () => {
    it("analyzes the stored legal JSON and saves provisions with roles", async () => {
        const db = createTestD1Database();

        const result = await analyzeStoredDocument(db, SEED_JOB_ID);

        expect(result.outcome).toBe("ANALYZED");

        const stored = await listProvisions(db, SEED_DOCUMENT_ID);
        const violation = stored.find((provision) => provision.id === `${SEED_DOCUMENT_ID}:dieu_5_khoan_2_diem_d`);

        expect(violation).toMatchObject({
            level: "POINT",
            articleNo: "5",
            paragraphNo: "2",
            pointNo: "d",
            contentRole: "ORDINARY_TEXT",
            relevance: "VIOLATION_RULE",
            parentId: `${SEED_DOCUMENT_ID}:dieu_5_khoan_2`,
        });
        expect(stored.map((provision) => provision.ordinal)).toEqual(stored.map((_, index) => index));
    });

    it("can be run again without duplicating rows", async () => {
        const db = createTestD1Database();

        await analyzeStoredDocument(db, SEED_JOB_ID);
        const firstCount = await countProvisions(db, SEED_DOCUMENT_ID);
        await analyzeStoredDocument(db, SEED_JOB_ID);

        expect(firstCount).toBeGreaterThan(0);
        expect(await countProvisions(db, SEED_DOCUMENT_ID)).toBe(firstCount);
    });

    it("reports a summary of roles and relevance", async () => {
        const db = createTestD1Database();

        const result = await analyzeStoredDocument(db, SEED_JOB_ID);

        if (result.outcome !== "ANALYZED") {
            throw new Error("Expected the seeded document to be analyzed");
        }

        expect(result.summary.total).toBe(await countProvisions(db, SEED_DOCUMENT_ID));
        expect(result.summary.byRelevance.SANCTION_RULE).toBeGreaterThan(0);
        expect(result.summary.byRelevance.VIOLATION_RULE).toBeGreaterThan(0);
    });

    it("answers NOT_FOUND for an unknown job", async () => {
        const db = createTestD1Database();

        expect((await analyzeStoredDocument(db, "missing-job")).outcome).toBe("NOT_FOUND");
    });

    it("refuses documents that still need review and stores nothing", async () => {
        const db = createTestD1Database();
        await db.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED' WHERE id = ?").bind(SEED_DOCUMENT_ID).run();

        const result = await analyzeStoredDocument(db, SEED_JOB_ID);

        expect(result.outcome).toBe("REVIEW_REQUIRED");
        expect(await countProvisions(db, SEED_DOCUMENT_ID)).toBe(0);
    });

    it("replaces earlier provisions instead of keeping stale ones", async () => {
        const db = createTestD1Database();
        const staleDocument = { content: null, articles: [{ number: "99", title: "Cũ", content: null, clauses: [] }] };

        await replaceProvisions(db, SEED_DOCUMENT_ID, analyzeLegalDocument(SEED_DOCUMENT_ID, staleDocument));
        await analyzeStoredDocument(db, SEED_JOB_ID);

        const stored = await listProvisions(db, SEED_DOCUMENT_ID);

        expect(stored.some((provision) => provision.id.endsWith(":dieu_99"))).toBe(false);
    });
});

describe("replaceProvisions", () => {
    it("stores documents larger than one insert chunk", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const clauses = Array.from({ length: 450 }, (_, index) => ({
            number: String(index + 1),
            title: null,
            content: `Phạt tiền từ 100.000 đồng đến 200.000 đồng đối với hành vi số ${index + 1}.`,
            points: [],
        }));
        const provisions = analyzeLegalDocument("big", { content: null, articles: [{ number: "1", title: "Xử phạt", content: null, clauses }] });

        await replaceProvisions(db, "big", provisions);

        expect(await countProvisions(db, "big")).toBe(451);

        const stored = await listProvisions(db, "big");

        expect(stored[450]).toMatchObject({ id: "big:dieu_1_khoan_450", relevance: "SANCTION_RULE", ordinal: 450 });
    });

    it("round-trips quoted segments, flags and the instruction a quote belongs to", async () => {
        const db = createTestD1Database({ seedSampleDocument: false });
        const provisions = analyzeLegalDocument("amend", {
            content: null,
            articles: [{
                number: "1",
                title: "Sửa đổi Nghị định",
                content: null,
                clauses: [{ number: "1", title: null, content: "Thay cụm từ “Bộ Giao thông vận tải” bằng cụm từ “Bộ Xây dựng” tại Điều 9.", points: [] }],
            }],
        });

        await replaceProvisions(db, "amend", provisions);

        const stored = await listProvisions(db, "amend");
        const clause = stored.find((provision) => provision.id === "amend:dieu_1_khoan_1");

        expect(clause?.quotedSegments).toEqual(["Bộ Giao thông vận tải", "Bộ Xây dựng"]);
        expect(clause?.flags).toEqual(["HAS_QUOTED_TEXT"]);
        expect(clause?.relevance).toBe("AMENDMENT_INSTRUCTION");
        expect(clause?.roleVersion).toBe("provision-roles-v1");
    });
});

describe("findDocumentIdByJobId", () => {
    it("maps a job id to the stored document id", async () => {
        const db = createTestD1Database();

        expect(await findDocumentIdByJobId(db, SEED_JOB_ID)).toBe(SEED_DOCUMENT_ID);
        expect(await findDocumentIdByJobId(db, "missing-job")).toBeNull();
    });
});
