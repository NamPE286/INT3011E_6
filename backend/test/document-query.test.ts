import { describe, expect, it } from "bun:test";
import type { D1Database } from "@cloudflare/workers-types";
import { app } from "../src/app";
import { buildChangeGraph } from "../src/modules/changes/change.service";
import { buildDocumentGraph } from "../src/modules/documents/document-graph.service";
import { createTestD1Database } from "./d1-test-db";
import { AMENDING_DECREE, BASE_DECREE, storeLegalDocument, type FixtureDocument } from "./legal-fixtures";
import { createMockEnv, withEnv } from "./mocks";

async function importDocument(db: D1Database, fixture: FixtureDocument): Promise<void> {
    await storeLegalDocument(db, fixture);
    await buildDocumentGraph(db, fixture.id);
    await buildChangeGraph(db, fixture.id);
}

async function createCorpus(): Promise<ReturnType<typeof createMockEnv>> {
    const env = createMockEnv({ DB: createTestD1Database({ seedSampleDocument: false }) });

    await importDocument(env.DB, BASE_DECREE);
    await importDocument(env.DB, AMENDING_DECREE);

    return env;
}

async function get(env: ReturnType<typeof createMockEnv>, path: string): Promise<Response> {
    return app.fetch(withEnv(new Request(`http://localhost${path}`), env));
}

describe("GET /api/documents", () => {
    it("finds a document by its number and returns display metadata", async () => {
        const env = await createCorpus();

        const response = await get(env, `/api/documents?q=${encodeURIComponent("100/2019/NĐ-CP")}`);
        const body = (await response.json()) as { documents: { id: string; documentNumber: string | null; title: string | null }[] };

        expect(response.status).toBe(200);
        expect(body.documents[0]).toMatchObject({ id: BASE_DECREE.id, documentNumber: "100/2019/NĐ-CP" });
    });

    it("lists the corpus when the query is empty", async () => {
        const env = await createCorpus();

        const response = await get(env, "/api/documents");
        const body = (await response.json()) as { documents: { id: string }[] };

        expect(response.status).toBe(200);
        expect(body.documents.map((document) => document.id).sort()).toEqual([AMENDING_DECREE.id, BASE_DECREE.id].sort());
    });

    it("never returns a document that still needs review", async () => {
        const env = await createCorpus();
        await env.DB.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED' WHERE id = ?").bind(BASE_DECREE.id).run();

        const searched = (await (await get(env, `/api/documents?q=${encodeURIComponent("100/2019/NĐ-CP")}`)).json()) as { documents: { id: string }[] };
        const listed = (await (await get(env, "/api/documents")).json()) as { documents: { id: string }[] };

        expect(searched.documents.map((document) => document.id)).not.toContain(BASE_DECREE.id);
        expect(listed.documents.map((document) => document.id)).not.toContain(BASE_DECREE.id);
    });

    it("says an empty result does not prove a document does not exist", async () => {
        const env = await createCorpus();

        const response = await get(env, "/api/documents?q=zzzzzz-khong-co");
        const body = (await response.json()) as { documents: unknown[]; disclaimer: string };

        expect(response.status).toBe(200);
        expect(body.documents).toEqual([]);
        expect(body.disclaimer.length).toBeGreaterThan(0);
    });

    it("rejects an invalid limit with a client error", async () => {
        const env = await createCorpus();

        const response = await get(env, "/api/documents?q=100&limit=500");

        expect(response.status).toBe(400);
    });
});

describe("GET /api/documents/:documentId", () => {
    it("returns the provisions in reading order with the amendments that touch them", async () => {
        const env = await createCorpus();

        const response = await get(env, `/api/documents/${BASE_DECREE.id}`);
        const body = (await response.json()) as {
            document: { id: string };
            metadata: { documentNumber: string | null } | null;
            provisions: { id: string; ordinal: number }[];
            amendments: { toProvisionId: string | null; relationType: string; verificationStatus: string; fromDocumentId: string; fromDocumentNumber: string | null }[];
        };

        expect(response.status).toBe(200);
        expect(body.document.id).toBe(BASE_DECREE.id);
        expect(body.metadata?.documentNumber).toBe("100/2019/NĐ-CP");

        const ordinals = body.provisions.map((provision) => provision.ordinal);

        expect(ordinals).toEqual([...ordinals].sort((left, right) => left - right));
        expect(body.amendments).toContainEqual(
            expect.objectContaining({
                toProvisionId: `${BASE_DECREE.id}:dieu_5_khoan_5_diem_a`,
                relationType: "AMENDS",
                verificationStatus: "ACCEPTED",
                fromDocumentId: AMENDING_DECREE.id,
            }),
        );
    });

    it("does not list the amending document's own instructions as amendments of itself", async () => {
        const env = await createCorpus();

        const body = (await (await get(env, `/api/documents/${AMENDING_DECREE.id}`)).json()) as { amendments: unknown[] };

        expect(body.amendments).toEqual([]);
    });

    it("returns 404 for an unknown document and for one that still needs review", async () => {
        const env = await createCorpus();
        await env.DB.prepare("UPDATE legal_documents SET review_status = 'REVIEW_REQUIRED' WHERE id = ?").bind(BASE_DECREE.id).run();

        const unknown = await get(env, "/api/documents/does-not-exist");
        const pending = await get(env, `/api/documents/${BASE_DECREE.id}`);

        expect(unknown.status).toBe(404);
        expect(pending.status).toBe(404);
    });
});
