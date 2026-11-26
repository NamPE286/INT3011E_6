import { describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { runLegalDebugSimulation } from "../src/modules/ide/ide.debug";
import { BUILTIN_TEMPLATES } from "../src/modules/ide/ide.templates";
import { createMockEnv, withEnv } from "./mocks";

describe("ide run and debug judge verdict", () => {
    it("acquits speed 12 km/h due to LP003 threshold gap", async () => {
        const result = await runLegalDebugSimulation({
            content: BUILTIN_TEMPLATES[0].content,
            scenario: "Anh A lái xe tự hành chạy quá tốc độ 12 km/h trên đường bộ.",
        });

        expect(result.verdict.outcome).toBe("ACQUITTED_LOOPHOLE");
        expect(result.verdict.exploitedDefects.some((item) => item.code === "LP003")).toBe(true);
        expect(result.trace.some((step) => step.status === "LOOPHOLE_HIT")).toBe(true);
    });

    it("flags conflict at 20 km/h due to LG002 overlapping thresholds", async () => {
        const result = await runLegalDebugSimulation({
            content: BUILTIN_TEMPLATES[0].content,
            scenario: "Người điều khiển xe chạy quá tốc độ 20 km/h.",
        });

        expect(result.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(result.verdict.exploitedDefects.some((item) => item.code === "LG002")).toBe(true);
    });

    it("marks organization at 8 km/h as loophole hit due to LP006 subject gap", async () => {
        const result = await runLegalDebugSimulation({
            content: BUILTIN_TEMPLATES[0].content,
            scenario: "Công ty vận tải X điều khiển xe chạy quá tốc độ 8 km/h.",
        });

        expect(result.verdict.outcome).toBe("ACQUITTED_LOOPHOLE");
        expect(result.verdict.exploitedDefects.some((item) => item.code === "LP006")).toBe(true);
    });

    it("serves POST /api/ide/debug endpoint", async () => {
        const env = createMockEnv();
        const res = await app.handle(
            withEnv(
                new Request("http://localhost/api/ide/debug", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        content: BUILTIN_TEMPLATES[0].content,
                        scenario: "Anh B dừng xe tại nơi có biển cấm dừng.",
                    }),
                }),
                env,
            ),
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as { verdict: { outcome: string } };

        expect(["GUILTY_SANCTIONED", "PARTIALLY_ENFORCEABLE"]).toContain(body.verdict.outcome);
    });

    it("supports interactive ambiguityOverrides to flip judge verdict", async () => {
        const draft = [
            "Điều 1. Xử phạt vi phạm",
            "1. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với hành vi gây hậu quả nghiêm trọng.",
            "Điều 2. Hiệu lực thi hành",
            "1. Có hiệu lực từ 01/01/2027.",
        ].join("\n");

        const unresolved = await runLegalDebugSimulation({
            content: draft,
            scenario: "Anh C gây hậu quả trong vụ va quẹt.",
        });

        expect(unresolved.ambiguities.length).toBeGreaterThan(0);
        const ambId = unresolved.ambiguities[0].id;

        const assumedTrue = await runLegalDebugSimulation({
            content: draft,
            scenario: "Anh C gây hậu quả trong vụ va quẹt.",
            ambiguityOverrides: { [ambId]: true },
        });
        expect(assumedTrue.verdict.outcome).toBe("GUILTY_SANCTIONED");

        const assumedFalse = await runLegalDebugSimulation({
            content: draft,
            scenario: "Anh C gây hậu quả trong vụ va quẹt.",
            ambiguityOverrides: { [ambId]: false },
        });
        expect(assumedFalse.verdict.outcome).toBe("NOT_COVERED");
    });

    it("imports a base law via /api/ide/library/import and proves term definition in workspace", async () => {
        const env = createMockEnv();
        const importRes = await app.handle(
            withEnv(
                new Request("http://localhost/api/ide/library/import", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        title: "Luật Trật tự ATGTĐB (Mẫu Thư viện)",
                        documentNumber: "36/2024/QH15",
                        documentType: "Luật",
                        content: [
                            "Điều 1. Giải thích từ ngữ",
                            "1. Điểm giấy phép lái xe là thang 12 điểm dùng để theo dõi việc chấp hành pháp luật.",
                        ].join("\n"),
                    }),
                }),
                env,
            ),
        );

        expect(importRes.status).toBe(201);

        const analyzeRes = await app.handle(
            withEnv(
                new Request("http://localhost/api/ide/analyze", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        content: "Điều 1. Xử phạt\n1. Người vi phạm bị trừ điểm giấy phép lái xe 02 điểm.",
                    }),
                }),
                env,
            ),
        );

        const analyzed = (await analyzeRes.json()) as {
            diagnostics: { code: string }[];
            terms: { normalizedTerm: string; status: string }[];
        };

        expect(analyzed.diagnostics.some((item) => item.code === "AM005")).toBe(false);
        expect(analyzed.terms.some((t) => t.normalizedTerm === "điểm giấy phép lái xe" && t.status === "DEFINED_IN_WORKSPACE")).toBe(true);
    });
});
