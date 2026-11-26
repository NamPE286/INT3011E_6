import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { buildSampleLibraryZip } from "../src/modules/ide/ide.library";
import { createZipArchive, unzipArchive } from "../src/modules/ide/ide.zip";
import { createMockEnv, withEnv } from "./mocks";

function callApp(path: string, init: RequestInit = {}, env = createMockEnv()): Promise<Response> {
    return app.handle(withEnv(new Request(`http://localhost${path}`, init), env));
}

describe("ide zip, batch library import, and docx/pdf export", () => {
    it("packs and unpacks ZIP archives and skips unsafe or macOS metadata entries", async () => {
        const zip = createZipArchive([
            { path: "luat-a.txt", content: "Điều 1. Nội dung luật A" },
            { path: "__MACOSX/._luat-a.txt", content: "junk" },
            { path: "../evil.txt", content: "traversal" },
        ]);

        const entries = await unzipArchive(zip);

        expect(entries.length).toBe(1);
        expect(entries[0].path).toBe("luat-a.txt");
        expect(new TextDecoder().decode(entries[0].bytes)).toBe("Điều 1. Nội dung luật A");
    });

    it("imports a batch of multiple laws and a .zip package into workspace", async () => {
        const env = createMockEnv();

        const batchRes = await callApp(
            "/api/ide/library/import",
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    laws: [
                        {
                            title: "Luật Giao thông A",
                            documentNumber: "10/2025/QH15",
                            content: "Điều 1. Giải thích từ ngữ\n1. Điểm chuẩn là thang 10 điểm.",
                        },
                        {
                            title: "Nghị định B",
                            documentNumber: "20/2025/NĐ-CP",
                            documentType: "Nghị định",
                            content: "Điều 1. Giải thích từ ngữ\n1. Camera AI là thiết bị ghi hình.",
                        },
                    ],
                }),
            },
            env,
        );

        expect(batchRes.status).toBe(201);
        const batchBody = (await batchRes.json()) as { count: number; items: { id: string }[] };

        expect(batchBody.count).toBe(2);
        expect(batchBody.items.length).toBe(2);

        const zipEnv = createMockEnv();
        const form = new FormData();
        const sampleZip = buildSampleLibraryZip();
        form.append("file", new File([new Uint8Array(sampleZip)], "bo-luat-mau.zip", { type: "application/zip" }));

        const zipRes = await callApp(
            "/api/ide/library/import-zip",
            {
                method: "POST",
                body: form,
            },
            zipEnv,
        );

        expect(zipRes.status).toBe(201);
        const zipBody = (await zipRes.json()) as { count: number; items: { documentNumber: string }[] };

        expect(zipBody.count).toBe(2);

        const wsRes = await callApp("/api/ide/workspace-context", {}, zipEnv);
        const ws = (await wsRes.json()) as {
            corpusDocumentCount: number;
            definedTerms: { normalizedTerm: string }[];
        };

        expect(ws.corpusDocumentCount).toBe(2);
        expect(ws.definedTerms.some((t) => t.normalizedTerm === "điểm giấy phép lái xe")).toBe(true);
        expect(ws.definedTerms.some((t) => t.normalizedTerm === "phạt nguội")).toBe(true);

        const sampleDownload = await callApp("/api/ide/library/sample-zip");

        expect(sampleDownload.status).toBe(200);
        expect(sampleDownload.headers.get("content-type")).toBe("application/zip");
    });

    it("exports Vietnamese legal DOCX and A4 print HTML with Times New Roman", async () => {
        const payload = {
            title: "Quy định xử phạt vi phạm hành chính về giao thông thông minh",
            documentNumber: "15/2026/NĐ-CP",
            content: [
                "Căn cứ Luật Trật tự, an toàn giao thông đường bộ số 36/2024/QH15;",
                "Chương I. QUY ĐỊNH CHUNG",
                "Điều 1. Phạm vi điều chỉnh",
                "1. Nghị định này quy định xử phạt đối với xe tự hành và hệ thống hỗ trợ lái.",
            ].join("\n"),
        };

        const docxRes = await callApp("/api/ide/export/docx", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });

        expect(docxRes.status).toBe(200);
        expect(docxRes.headers.get("content-type")).toContain("wordprocessingml.document");

        const docxBytes = new Uint8Array(await docxRes.arrayBuffer());
        const entries = await unzipArchive(docxBytes);
        const byPath = new Map(entries.map((entry) => [entry.path, new TextDecoder().decode(entry.bytes)]));

        expect(byPath.has("[Content_Types].xml")).toBe(true);
        expect(byPath.has("word/document.xml")).toBe(true);
        expect(byPath.has("word/styles.xml")).toBe(true);
        expect(byPath.has("word/header1.xml")).toBe(true);

        const docXml = byPath.get("word/document.xml") ?? "";
        const stylesXml = byPath.get("word/styles.xml") ?? "";

        expect(stylesXml).toContain("Times New Roman");
        expect(docXml).toContain("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM");
        expect(docXml).toContain("15/2026/NĐ-CP");
        expect(docXml).toContain("11906");
        expect(docXml).toContain("16838");
        expect(docXml).toContain("1701");

        const htmlRes = await callApp("/api/ide/export/html", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });

        expect(htmlRes.status).toBe(200);
        expect(htmlRes.headers.get("content-type")).toContain("text/html");
        const html = await htmlRes.text();

        expect(html).toContain("Times New Roman");
        expect(html).toContain("@page");
        expect(html).toContain("20mm 15mm 20mm 30mm");
        expect(html).toContain("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM");
    });
});
