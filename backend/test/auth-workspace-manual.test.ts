import { describe, expect, it } from "bun:test";
import type { ExecutionContext } from "@cloudflare/workers-types";
import worker from "../src/index";
import { createTestD1Database } from "./d1-test-db";
import { createMockEnv } from "./mocks";

function createTestEnv() {
    const db = createTestD1Database({ seedSampleDocument: false });

    return createMockEnv({ DB: db });
}

async function fetchApp(
    env: ReturnType<typeof createTestEnv>,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const request = new Request(`http://localhost:8787${path}`, init);

    return worker.fetch(request, env, {} as ExecutionContext);
}

function extractCookie(response: Response): string {
    const raw = response.headers.get("set-cookie");

    if (!raw) {
        return "";
    }

    return raw
        .split(",")
        .map((part) => part.split(";")[0]?.trim())
        .filter((part): part is string => Boolean(part))
        .join("; ");
}

async function signUpAndGetCookie(
    env: ReturnType<typeof createTestEnv>,
    email: string,
    password: string,
    name: string,
): Promise<{ cookie: string; userId: string }> {
    const res = await fetchApp(env, "/api/auth/sign-up/email", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:5173",
        },
        body: JSON.stringify({ email, password, name }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string } };
    const cookie = extractCookie(res);
    expect(cookie.length).toBeGreaterThan(0);

    return { cookie, userId: body.user.id };
}

describe("Better Auth, Multi-Workspace Isolation, Manual Mode, and Dual-Mode Graph", () => {
    it("registers, signs in, reads session, and signs out with Better Auth email+password", async () => {
        const env = createTestEnv();
        const { cookie } = await signUpAndGetCookie(env, "lawmaker@gov.vn", "secret123", "Nhà soạn luật A");

        const sessionRes = await fetchApp(env, "/api/auth/get-session", {
            headers: { Cookie: cookie },
        });
        expect(sessionRes.status).toBe(200);
        const sessionData = (await sessionRes.json()) as { user: { email: string; name: string } };
        expect(sessionData.user.email).toBe("lawmaker@gov.vn");
        expect(sessionData.user.name).toBe("Nhà soạn luật A");

        const signInRes = await fetchApp(env, "/api/auth/sign-in/email", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Origin: "http://localhost:5173",
            },
            body: JSON.stringify({ email: "lawmaker@gov.vn", password: "secret123" }),
        });
        expect(signInRes.status).toBe(200);
        expect(extractCookie(signInRes).length).toBeGreaterThan(0);
    });

    it("isolates datasets and graphs across workspaces and blocks cross-account access", async () => {
        const env = createTestEnv();
        const userA = await signUpAndGetCookie(env, "drafter-a@gov.vn", "pass1234", "Drafter A");
        const userB = await signUpAndGetCookie(env, "drafter-b@gov.vn", "pass1234", "Drafter B");

        const ws1Res = await fetchApp(env, "/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: userA.cookie },
            body: JSON.stringify({ name: "Chuyên đề Thuế 2026", domain: "tax", seedSample: false }),
        });
        expect(ws1Res.status).toBe(201);
        const ws1 = ((await ws1Res.json()) as { workspace: { id: string } }).workspace;

        const ws2Res = await fetchApp(env, "/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: userA.cookie },
            body: JSON.stringify({ name: "Chuyên đề Lao động 2026", domain: "labor", seedSample: false }),
        });
        expect(ws2Res.status).toBe(201);
        const ws2 = ((await ws2Res.json()) as { workspace: { id: string } }).workspace;

        // Create a manual doc in ws1
        const docRes = await fetchApp(env, "/api/manual/documents", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Cookie: userA.cookie,
                "X-Workspace-Id": ws1.id,
            },
            body: JSON.stringify({
                title: "Dự thảo Luật Thuế số 01",
                documentNumber: "01/2026/DT-QH",
                documentType: "Dự thảo",
            }),
        });
        expect(docRes.status).toBe(201);

        // ws1 has 1 document, ws2 has 0 documents
        const ws1Docs = (await (
            await fetchApp(env, "/api/documents", {
                headers: { Cookie: userA.cookie, "X-Workspace-Id": ws1.id },
            })
        ).json()) as { documents: unknown[] };
        expect(ws1Docs.documents).toHaveLength(1);

        const ws2Docs = (await (
            await fetchApp(env, "/api/documents", {
                headers: { Cookie: userA.cookie, "X-Workspace-Id": ws2.id },
            })
        ).json()) as { documents: unknown[] };
        expect(ws2Docs.documents).toHaveLength(0);

        // User B cannot access User A's workspace
        const forbiddenRes = await fetchApp(env, "/api/graph", {
            headers: { Cookie: userB.cookie, "X-Workspace-Id": ws1.id },
        });
        expect(forbiddenRes.status).toBe(403);
    });

    it("supports manual authoring (Điều/Khoản/Điểm) and dual-mode graph edges (Mode 1 sanction change & Mode 2 influence)", async () => {
        const env = createTestEnv();
        const user = await signUpAndGetCookie(env, "editor@gov.vn", "pass1234", "Editor");

        const wsRes = await fetchApp(env, "/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: user.cookie },
            body: JSON.stringify({ name: "Workspace Soạn thảo", seedSample: false }),
        });
        const wsId = ((await wsRes.json()) as { workspace: { id: string } }).workspace.id;
        const headers = { "Content-Type": "application/json", Cookie: user.cookie, "X-Workspace-Id": wsId };

        // Create 2 manual documents
        const docOld = ((await (
            await fetchApp(env, "/api/manual/documents", {
                method: "POST",
                headers,
                body: JSON.stringify({ title: "Nghị định cũ", documentNumber: "100/2019/NĐ-CP", issuedAt: "2019-12-30" }),
            })
        ).json()) as { document: { id: string } }).document;

        const docNew = ((await (
            await fetchApp(env, "/api/manual/documents", {
                method: "POST",
                headers,
                body: JSON.stringify({ title: "Dự thảo mới", documentNumber: "01/2026/DT", issuedAt: "2026-06-01" }),
            })
        ).json()) as { document: { id: string } }).document;

        // Insert Điều -> Khoản -> Điểm into docNew
        const art = ((await (
            await fetchApp(env, `/api/manual/documents/${docNew.id}/provisions`, {
                method: "POST",
                headers,
                body: JSON.stringify({ level: "ARTICLE", number: "5", title: "Xử phạt vi phạm" }),
            })
        ).json()) as { provision: { id: string; articleNo: string } }).provision;
        expect(art.articleNo).toBe("5");

        const clause = ((await (
            await fetchApp(env, `/api/manual/documents/${docNew.id}/provisions`, {
                method: "POST",
                headers,
                body: JSON.stringify({ parentId: art.id, level: "CLAUSE", number: "1", text: "Phạt tiền từ 10 đến 12 triệu:" }),
            })
        ).json()) as { provision: { id: string; articleNo: string; paragraphNo: string } }).provision;
        expect(clause.articleNo).toBe("5");
        expect(clause.paragraphNo).toBe("1");

        const point = ((await (
            await fetchApp(env, `/api/manual/documents/${docNew.id}/provisions`, {
                method: "POST",
                headers,
                body: JSON.stringify({ parentId: clause.id, level: "POINT", number: "a", text: "Vượt đèn đỏ." }),
            })
        ).json()) as { provision: { id: string; pointNo: string } }).provision;
        expect(point.pointNo).toBe("a");

        // Link Mode 2 (Document Influence)
        const docRelRes = await fetchApp(env, "/api/manual/graph/document-relations", {
            method: "POST",
            headers,
            body: JSON.stringify({
                fromDocumentId: docNew.id,
                toDocumentId: docOld.id,
                relationType: "AMENDS",
                scope: "PARTIAL",
                note: "Sửa đổi mức phạt đèn tín hiệu",
            }),
        });
        expect(docRelRes.status).toBe(201);

        // Link Mode 1 (Sanction Escalation)
        const sanctionRes = await fetchApp(env, "/api/manual/graph/sanction-edges", {
            method: "POST",
            headers,
            body: JSON.stringify({
                fromDocumentId: docNew.id,
                toDocumentId: docOld.id,
                fromProvisionId: point.id,
                behaviorSummary: "Vượt đèn đỏ",
                changeType: "SANCTION_INCREASE",
                oldPenaltyText: "4-6 triệu",
                newPenaltyText: "10-12 triệu",
                oldFineMin: 4000000,
                oldFineMax: 6000000,
                newFineMin: 10000000,
                newFineMax: 12000000,
                note: "Tăng gấp đôi khung phạt",
            }),
        });
        expect(sanctionRes.status).toBe(201);

        // Fetch dual-mode graph
        const graphRes = await fetchApp(env, "/api/graph", {
            headers: { Cookie: user.cookie, "X-Workspace-Id": wsId },
        });
        expect(graphRes.status).toBe(200);
        const graph = (await graphRes.json()) as {
            documents: unknown[];
            documentRelations: { sourceMode: string; relationType: string }[];
            sanctionChangeEdges: { sourceMode: string; changeType: string; severityDeltaPercent: number }[];
        };

        expect(graph.documents).toHaveLength(2);
        expect(graph.documentRelations).toHaveLength(1);
        expect(graph.documentRelations[0]?.sourceMode).toBe("MANUAL");
        expect(graph.sanctionChangeEdges).toHaveLength(1);
        expect(graph.sanctionChangeEdges[0]?.changeType).toBe("SANCTION_INCREASE");
        expect(graph.sanctionChangeEdges[0]?.severityDeltaPercent).toBe(100);
    });
});
