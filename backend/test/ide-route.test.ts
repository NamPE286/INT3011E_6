import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { DEFAULT_TEMPLATE_ID } from "../src/modules/ide/ide.templates";
import { createMockEnv, withEnv } from "./mocks";

function callApp(path: string, init: RequestInit = {}, env = createMockEnv()): Promise<Response> {
    return app.handle(withEnv(new Request(`http://localhost${path}`, init), env));
}

describe("ide routes", () => {
    it("lists built-in templates and loads the default template with analysis", async () => {
        const listRes = await callApp("/api/ide/drafts");

        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as { drafts: unknown[]; templates: { id: string }[] };

        expect(listBody.templates.length).toBeGreaterThanOrEqual(3);
        expect(listBody.templates[0].id).toBe(DEFAULT_TEMPLATE_ID);

        const getRes = await callApp(`/api/ide/drafts/${DEFAULT_TEMPLATE_ID}`);

        expect(getRes.status).toBe(200);
        const getBody = (await getRes.json()) as { draft: { id: string }; analysis: { diagnostics: unknown[] } };

        expect(getBody.draft.id).toBe(DEFAULT_TEMPLATE_ID);
        expect(getBody.analysis.diagnostics.length).toBeGreaterThan(0);
    });

    it("creates, updates, analyzes, and deletes a draft in D1", async () => {
        const env = createMockEnv();

        const createRes = await callApp(
            "/api/ide/drafts",
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    title: "Dự thảo kiểm thử",
                    documentNumber: "99/2026/NĐ-CP",
                    content: "Điều 1. Thử nghiệm\n1. Phạt tiền từ 5.000.000 đồng đến 3.000.000 đồng.",
                }),
            },
            env,
        );

        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { draft: { id: string }; analysis: { diagnostics: { code: string }[] } };

        expect(created.analysis.diagnostics.some((item) => item.code === "LG001")).toBe(true);

        const updateRes = await callApp(
            `/api/ide/drafts/${created.draft.id}`,
            {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    content: "Điều 1. Thử nghiệm\n1. Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng.\nĐiều 2. Hiệu lực thi hành\n1. Có hiệu lực từ 01/01/2027.",
                }),
            },
            env,
        );

        expect(updateRes.status).toBe(200);
        const updated = (await updateRes.json()) as { analysis: { diagnostics: { code: string }[] } };

        expect(updated.analysis.diagnostics.some((item) => item.code === "LG001")).toBe(false);

        const delRes = await callApp(`/api/ide/drafts/${created.draft.id}`, { method: "DELETE" }, env);

        expect(delRes.status).toBe(200);
    });

    it("rejects unsupported model in /api/ide/analyze", async () => {
        const res = await callApp("/api/ide/analyze", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                content: "Điều 1. Test",
                model: "unsupported-model",
            }),
        });

        expect(res.status).toBe(400);
    });

    it("returns strictly workspace-only context from /api/ide/workspace-context", async () => {
        const env = createMockEnv();
        const emptyRes = await callApp("/api/ide/workspace-context", {}, env);

        expect(emptyRes.status).toBe(200);
        const emptyCtx = (await emptyRes.json()) as { corpusDocumentCount: number; savedDraftCount: number; bases: unknown[] };

        expect(emptyCtx.corpusDocumentCount).toBe(0);
        expect(emptyCtx.savedDraftCount).toBe(0);
        expect(emptyCtx.bases.length).toBe(0);

        await callApp(
            "/api/ide/drafts",
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    title: "Luật Mẫu Workspace",
                    documentNumber: "12/2026/QH15",
                    content: "Điều 1. Giải thích từ ngữ\n1. Điểm giấy phép lái xe là thang điểm 12.",
                }),
            },
            env,
        );

        const populatedRes = await callApp("/api/ide/workspace-context", {}, env);
        const populatedCtx = (await populatedRes.json()) as { savedDraftCount: number; bases: unknown[]; definedTerms: { normalizedTerm: string }[] };

        expect(populatedCtx.savedDraftCount).toBe(1);
        expect(populatedCtx.bases.length).toBeGreaterThan(0);
        expect(populatedCtx.definedTerms.some((term) => term.normalizedTerm === "điểm giấy phép lái xe")).toBe(true);
    });
});
