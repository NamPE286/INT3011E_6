import { describe, expect, it } from "bun:test";
import { analyzeLocalDraft } from "./analyzer";
import { runLocalDebugSimulation } from "./debug";
import { runItdLiveJudge, runItdLoopholeDetector } from "./itd-harness";
import type { LocalWorkspaceFile } from "./local-workspace";

describe("ITD Distilled Engine Capabilities (Red -> Green)", () => {
    it("does not emit LP006 when clause explicitly covers both cá nhân và/hoặc tổ chức", async () => {
        const draft = [
            "Hợp đồng thuê mặt bằng số 01/2026/HĐTM",
            "Điều 1. Phạt chậm thanh toán",
            "1. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân hoặc tổ chức chậm thanh toán từ 05 ngày đến dưới 15 ngày.",
            "2. Phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng đối với cá nhân và tổ chức chậm thanh toán từ 15 ngày đến 30 ngày.",
            "Điều 2. Hiệu lực thi hành",
            "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n");

        const res = await analyzeLocalDraft(draft, [], { includeAi: false });

        expect(res.diagnostics.filter((d) => d.code === "LP006")).toEqual([]);
    });

    it("detects boundary gaps/overlaps in multi-domain units (ngày, giờ, triệu đồng) and inverted prison ranges (LG001)", async () => {
        const draftGap = [
            "Dự thảo Nghị định lao động",
            "Điều 1. Xử phạt làm thêm giờ",
            "1. Phạt tiền từ 2.000.000 đồng đến 5.000.000 đồng đối với cá nhân và tổ chức huy động làm thêm từ 01 giờ đến dưới 20 giờ.",
            "2. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân và tổ chức huy động làm thêm từ 25 giờ đến 40 giờ.",
            "Điều 2. Hiệu lực thi hành",
            "1. Có hiệu lực kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n");

        const resGap = await analyzeLocalDraft(draftGap, [], { includeAi: false });

        expect(resGap.diagnostics.some((d) => d.code === "LP003")).toBe(true);

        const draftPrisonInv = [
            "Dự thảo Luật Hình sự",
            "Điều 1. Tội chế tạo vũ khí",
            "1. Người nào chế tạo từ 02 đơn vị đến 05 đơn vị thì bị phạt tù từ 10 năm đến 03 năm.",
            "Điều 2. Hiệu lực thi hành",
            "1. Có hiệu lực kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n");

        const resPrison = await analyzeLocalDraft(draftPrisonInv, [], { includeAi: false });

        expect(resPrison.diagnostics.some((d) => d.code === "LG001")).toBe(true);
    });

    it("aggregates fines across multiple simultaneous violations in Debug simulation", async () => {
        const draft = [
            "Nghị định số 168/2024/NĐ-CP",
            "Điều 2. Xử phạt người điều khiển xe mô tô",
            "1. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe mô tô không đội mũ bảo hiểm.",
            "2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe mô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
            "3. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe mô tô sử dụng điện thoại khi đang điều khiển xe.",
        ].join("\n");

        const res = await runLocalDebugSimulation({
            content: draft,
            scenario: "Chị B đi xe máy vừa không đội mũ bảo hiểm, vừa vượt đèn đỏ, vừa sử dụng điện thoại khi đang điều khiển xe.",
        });

        expect(res.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(res.verdict.applicableFine).toEqual({ min: 5_200_000, max: 7_600_000 });
        expect(res.tokenUsage?.totalTokens).toBe(0);
    });

    it("extracts criminal non-monetary sanctions and blocks inverted prison terms with LG001", async () => {
        const draft = [
            "Bộ luật Hình sự số 100/2015/QH13",
            "Điều 249. Tội tàng trữ trái phép chất ma túy",
            "2. Phạm tội tàng trữ trái phép chất ma túy có khối lượng từ 05 gam đến dưới 30 gam thì bị phạt tù từ 05 năm đến 10 năm và tịch thu tang vật.",
            "Điều 306. Tội chế tạo vũ khí quân dụng",
            "1. Người nào chế tạo vũ khí quân dụng từ 02 đơn vị đến 05 đơn vị thì bị phạt tù từ 10 năm đến 03 năm.",
        ].join("\n");

        const validRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Bị cáo X tàng trữ trái phép chất ma túy có khối lượng 12 gam.",
        });

        expect(validRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(validRes.verdict.applicableFine).toBeNull();
        expect(validRes.verdict.additionalSanctions.join(" ").toLowerCase()).toContain("phạt tù");
        expect(validRes.verdict.additionalSanctions.join(" ").toLowerCase()).toContain("tịch thu tang vật");

        const invRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Đối tượng Z chế tạo vũ khí quân dụng với số lượng 03 đơn vị.",
        });

        expect(invRes.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(invRes.verdict.exploitedDefects.some((d) => d.code === "LG001")).toBe(true);
    });

    it("resolves cross-document repeal and amendment from workspaceFiles during Debug", async () => {
        const draft = [
            "Nghị định số 100/2019/NĐ-CP quy định xử phạt vi phạm giao thông",
            "Điều 5. Xử phạt vi phạm quy định về đèn tín hiệu và dừng đỗ",
            "1. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe ô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
            "2. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với người điều khiển xe ô tô dừng xe tại nơi có biển cấm dừng.",
            "Điều 6. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2020.",
        ].join("\n");

        const repealWs: LocalWorkspaceFile = {
            path: "library/nd-123.txt",
            name: "nd-123.txt",
            title: "Nghị định 123/2021/NĐ-CP",
            documentNumber: "123/2021/NĐ-CP",
            documentType: "Nghị định",
            content: [
                "Nghị định số 123/2021/NĐ-CP",
                "Điều 1. Bãi bỏ quy định",
                "1. Bãi bỏ khoản 2 Điều 5 Nghị định 100/2019/NĐ-CP.",
                "Điều 2. Hiệu lực thi hành",
                "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2022.",
            ].join("\n"),
            isLibrary: true,
            updatedAt: "2026-11-26T00:00:00.000Z",
        };

        const amendWs: LocalWorkspaceFile = {
            path: "library/nd-168.txt",
            name: "nd-168.txt",
            title: "Nghị định 168/2024/NĐ-CP",
            documentNumber: "168/2024/NĐ-CP",
            documentType: "Nghị định",
            content: [
                "Nghị định số 168/2024/NĐ-CP",
                "Điều 1. Sửa đổi quy định",
                "1. Sửa đổi khoản 1 Điều 5 Nghị định 100/2019/NĐ-CP như sau: Phạt tiền từ 18.000.000 đồng đến 20.000.000 đồng đối với người điều khiển xe ô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
                "Điều 2. Hiệu lực thi hành",
                "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2025.",
            ].join("\n"),
            isLibrary: true,
            updatedAt: "2026-11-26T00:00:00.000Z",
        };

        const repealedRes = await runLocalDebugSimulation({
            content: draft,
            workspaceFiles: [repealWs],
            scenario: "Ngày 10/05/2023, anh T lái xe ô tô dừng xe tại nơi có biển cấm dừng.",
        });

        expect(repealedRes.verdict.outcome).toBe("ACQUITTED_LOOPHOLE");
        expect(repealedRes.verdict.applicableFine).toBeNull();
        expect(repealedRes.verdict.exploitedDefects.some((d) => d.code === "LG007")).toBe(true);

        const amendedRes = await runLocalDebugSimulation({
            content: draft,
            workspaceFiles: [amendWs],
            scenario: "Ngày 15/03/2025, anh H lái xe ô tô vượt đèn đỏ tại ngã tư.",
        });

        expect(amendedRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(amendedRes.verdict.applicableFine).toEqual({ min: 18_000_000, max: 20_000_000 });
    });

    it("handles temporal effectiveDate, qualified exceptions, nested double negation, and abstention on missing thresholds", async () => {
        const draft = [
            "Dự thảo Nghị định quản lý thiết bị bay",
            "Điều 1. Xử phạt vận hành thiết bị bay",
            "1. Phạt tiền từ 10.000.000 đồng đến 15.000.000 đồng đối với cá nhân vận hành thiết bị bay không người lái trong khu vực hạn chế, trừ trường hợp có giấy phép bay của cơ quan có thẩm quyền; không áp dụng miễn trừ nếu gây cháy nổ.",
            "Điều 2. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2027.",
        ].join("\n");

        const preEff = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ngày 15/08/2026, anh E vận hành thiết bị bay không người lái trong khu vực hạn chế không có giấy phép bay.",
        });

        expect(preEff.verdict.outcome).toBe("NOT_COVERED");
        expect(preEff.verdict.applicableFine).toBeNull();

        const exemptOk = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ngày 10/02/2027, anh A vận hành thiết bị bay không người lái trong khu vực hạn chế nhưng có giấy phép bay của cơ quan có thẩm quyền.",
        });

        expect(exemptOk.verdict.outcome).toBe("NOT_COVERED");
        expect(exemptOk.verdict.applicableFine).toBeNull();

        const doubleNeg = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ngày 10/02/2027, anh B vận hành thiết bị bay không người lái trong khu vực hạn chế có giấy phép bay của cơ quan có thẩm quyền nhưng gây cháy nổ.",
        });

        expect(doubleNeg.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(doubleNeg.verdict.applicableFine).toEqual({ min: 10_000_000, max: 15_000_000 });

        const taxDraft = [
            "Nghị định xử phạt vi phạm thuế",
            "Điều 2. Xử phạt chậm nộp hồ sơ khai thuế",
            "1. Phạt tiền từ 2.000.000 đồng đến 5.000.000 đồng đối với cá nhân chậm nộp hồ sơ khai thuế từ 01 ngày đến dưới 30 ngày.",
            "2. Phạt tiền từ 5.000.000 đồng đến 8.000.000 đồng đối với cá nhân chậm nộp hồ sơ khai thuế từ 30 ngày đến 60 ngày.",
        ].join("\n");

        const missingMeasure = await runLocalDebugSimulation({
            content: taxDraft,
            scenario: "Ông Toàn nộp chậm hồ sơ khai thuế nhưng hồ sơ không nêu rõ chậm bao nhiêu ngày.",
        });

        expect(missingMeasure.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(missingMeasure.verdict.applicableFine).toBeNull();
        expect(missingMeasure.verdict.exploitedDefects.some((d) => d.code === "INSUFFICIENT_FACTS")).toBe(true);
    });

    it("runs ITD Loophole Detector and Live Judge with verbatim grounding, Decision gate, and Flash-Lite fallback telemetry", async () => {
        const deonticDraft = [
            "Hợp đồng bảo mật số 01/2026",
            "Điều 1. Quy định tiết lộ thông tin",
            "1. Nghiêm cấm tiết lộ thông tin mật cho bên thứ ba; vi phạm bị phạt tiền từ 20.000.000 đồng đến 40.000.000 đồng đối với cá nhân và tổ chức.",
            "2. Cho phép tiết lộ thông tin mật cho bên thứ ba.",
            "Điều 2. Hiệu lực thi hành",
            "1. Hợp đồng có hiệu lực kể từ ngày 01 tháng 01 năm 2026.",
        ].join("\n");

        const lh = await runItdLoopholeDetector({
            caseId: "UNIT-LH-01",
            draftContent: deonticDraft,
        });

        expect(lh.output.hasLoophole).toBe(true);
        expect(lh.output.workspaceOnly).toBe(true);
        expect(lh.output.findings.some((f) => f.code === "DEONTIC_CONFLICT")).toBe(true);
        expect(deonticDraft.includes(lh.output.findings[0].verbatimQuote)).toBe(true);

        const paraphraseDraft = [
            "Dự thảo Nghị định kiểm dịch",
            "Điều 1. Xử phạt vi phạm kiểm dịch động vật",
            "1. Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với cá nhân vận chuyển gia súc không có giấy kiểm dịch.",
        ].join("\n");

        let decisionCalled = false;
        let mapperCalled = false;

        const fakeFetch = (async (url: string) => {
            if (url.includes("/v1beta/decisions")) {
                decisionCalled = true;

                return new Response(
                    JSON.stringify({
                        answers: { matches_any: { type: "noul", noul: 0.91, confidence: 0.92 } },
                        usage: { total_input_tokens: 120, total_output_tokens: 0, total_tokens: 120 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            mapperCalled = true;

            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({ matchedProvisionRefs: ["Khoản 1 Điều 1"] }),
                    usage: { total_input_tokens: 210, total_output_tokens: 28, total_tokens: 238 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const judgeRes = await runItdLiveJudge({
            caseId: "UNIT-JG-01",
            draftContent: paraphraseDraft,
            scenario: "Ông T chở đàn bò qua trạm mà thiếu chứng nhận thú y.",
            useAi: true,
            apiKey: "unit-test-only",
            fetcher: fakeFetch,
        });

        expect(decisionCalled).toBe(true);
        expect(mapperCalled).toBe(true);
        expect(judgeRes.output.outcome).toBe("GUILTY_SANCTIONED");
        expect(judgeRes.output.applicableFine).toEqual({ min: 3_000_000, max: 5_000_000 });
        expect(judgeRes.output.citations.length).toBeGreaterThan(0);
        expect(judgeRes.usage.llmCalls).toBe(2);
        expect(judgeRes.usage.decisionInputTokens).toBe(120);
        expect(judgeRes.usage.inputTokens).toBe(210);
        expect(judgeRes.usage.outputTokens).toBe(28);
    });

    it("gates clean drafts in ITD Loophole Detector via Channel 3 Decision API without false positives or Flash-Lite calls", async () => {
        const cleanDraft = [
            "Hợp đồng cung cấp dịch vụ số 12/2026",
            "Điều 1. Xử phạt vi phạm thời hạn bàn giao",
            "1. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân hoặc tổ chức chậm bàn giao từ 01 ngày đến dưới 10 ngày.",
            "2. Phạt tiền từ 4.000.000 đồng đến 8.000.000 đồng đối với cá nhân hoặc tổ chức chậm bàn giao từ 10 ngày đến 30 ngày.",
            "Điều 2. Hiệu lực thi hành",
            "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2026.",
        ].join("\n");

        let decisionCalls = 0;
        let flashCalls = 0;

        const fakeFetch = (async (url: string) => {
            if (url.includes("/v1beta/decisions")) {
                decisionCalls += 1;

                return new Response(
                    JSON.stringify({
                        answers: { has_implicit_defect: { type: "noul", noul: 0.04, confidence: 0.96 } },
                        usage: { total_input_tokens: 185, total_output_tokens: 0, total_tokens: 185 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            flashCalls += 1;

            return new Response("{}", { status: 500 });
        }) as unknown as typeof fetch;

        const res = await runItdLoopholeDetector({
            caseId: "UNIT-LH-CLEAN-01",
            draftContent: cleanDraft,
            useAi: true,
            useDecisionApi: true,
            apiKey: "unit-test-only",
            fetcher: fakeFetch,
        });

        expect(decisionCalls).toBe(1);
        expect(flashCalls).toBe(0);
        expect(res.output.hasLoophole).toBe(false);
        expect(res.output.findings).toEqual([]);
        expect(res.usage.llmCalls).toBe(1);
        expect(res.usage.decisionInputTokens).toBe(185);
        expect(res.usage.outputTokens).toBe(0);
        expect(res.usage.modelUsed).toBe("gemini-decision-1");
    });

    it("records both LP002 and AM005 in multi-violation PARTIALLY_ENFORCEABLE scenarios (JG-DEV-MV04)", async () => {
        const draft = [
            "Nghị định số 168/2024/NĐ-CP quy định xử phạt vi phạm hành chính về giao thông đường bộ",
            "Điều 2. Xử phạt người điều khiển xe mô tô",
            "1. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe mô tô không đội mũ bảo hiểm.",
            "Điều 3. Xử phạt hành vi bị nghiêm cấm",
            "1. Nghiêm cấm tự ý can thiệp phần mềm hệ thống hỗ trợ lái của xe mô tô điện.",
            "Điều 4. Hiệu lực thi hành",
            "1. Nghị định này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2025.",
        ].join("\n");

        const judgeRes = await runItdLiveJudge({
            caseId: "UNIT-JG-MV04",
            draftContent: draft,
            scenario: "Anh D đi xe máy không đội mũ bảo hiểm và tự ý can thiệp phần mềm hệ thống hỗ trợ lái của xe mô tô điện.",
        });

        expect(judgeRes.output.outcome).toBe("PARTIALLY_ENFORCEABLE");
        expect(judgeRes.output.abstained).toBe(false);
        expect(judgeRes.output.applicableFine).toEqual({ min: 400_000, max: 600_000 });
        expect(judgeRes.output.detectedDefectCodes).toContain("LP002");
        expect(judgeRes.output.detectedDefectCodes).toContain("AM005");
        expect(judgeRes.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 2")).toBe(true);
        expect(judgeRes.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 3")).toBe(true);
        expect(judgeRes.usage.llmCalls).toBe(0);
    });

    it("escalates missed secondary violation in compound scenarios via Channel 3 Decision API (without noul criteria) + Channel 4 mapper", async () => {
        const contractDraft = [
            "Hợp đồng thi công xây dựng số 08/2026/HĐXD",
            "Điều 1. Vi phạm tiến độ thi công",
            "1. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân và tổ chức chậm tiến độ thi công từ 10 ngày đến 30 ngày.",
            "Điều 2. Vi phạm chất lượng vật tư",
            "1. Phạt tiền từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân và tổ chức sử dụng vật tư không bảo đảm chất lượng theo hồ sơ thiết kế.",
            "Điều 3. Hiệu lực thi hành",
            "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2026.",
        ].join("\n");

        const decisionBodies: Record<string, unknown>[] = [];
        let flashCalls = 0;

        const fakeFetchEscalate = (async (url: string, init?: RequestInit) => {
            if (url.includes("/v1beta/decisions")) {
                const parsed = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
                decisionBodies.push(parsed);

                return new Response(
                    JSON.stringify({
                        answers: { missed_secondary_violation: { type: "noul", noul: 0.89, confidence: 0.91 } },
                        usage: { total_input_tokens: 145, total_output_tokens: 0, total_tokens: 145 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            flashCalls += 1;

            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({ matchedProvisionRefs: ["Khoản 1 Điều 2"] }),
                    usage: { total_input_tokens: 190, total_output_tokens: 24, total_tokens: 214 },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const escalated = await runItdLiveJudge({
            caseId: "UNIT-JG-SEC-01",
            draftContent: contractDraft,
            scenario: "Nhà thầu vừa chậm tiến độ thi công 15 ngày, vừa tự ý tráo chủng loại thép sai bản vẽ kỹ thuật.",
            useAi: true,
            apiKey: "unit-test-only",
            fetcher: fakeFetchEscalate,
        });

        expect(decisionBodies).toHaveLength(1);
        const questions = decisionBodies[0].questions as Record<string, Record<string, unknown>>;
        expect(questions.missed_secondary_violation?.type).toBe("noul");
        expect("criteria" in (questions.missed_secondary_violation ?? {})).toBe(false);
        expect(flashCalls).toBe(1);
        expect(escalated.output.outcome).toBe("GUILTY_SANCTIONED");
        expect(escalated.output.applicableFine).toEqual({ min: 20_000_000, max: 35_000_000 });
        expect(escalated.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 1")).toBe(true);
        expect(escalated.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 2")).toBe(true);
        expect(escalated.usage.llmCalls).toBe(2);
        expect(escalated.usage.decisionInputTokens).toBe(145);
        expect(escalated.usage.inputTokens).toBe(190);
        expect(escalated.usage.outputTokens).toBe(24);

        // When Decision API rejects secondary violation (low noul), Channel 4 must NOT be called
        let rejectedFlashCalls = 0;

        const fakeFetchReject = (async (url: string) => {
            if (url.includes("/v1beta/decisions")) {
                return new Response(
                    JSON.stringify({
                        answers: { missed_secondary_violation: { type: "noul", noul: 0.11, confidence: 0.93 } },
                        usage: { total_input_tokens: 140, total_output_tokens: 0, total_tokens: 140 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            rejectedFlashCalls += 1;

            return new Response("{}", { status: 500 });
        }) as unknown as typeof fetch;

        const gated = await runItdLiveJudge({
            caseId: "UNIT-JG-SEC-02",
            draftContent: contractDraft,
            scenario: "Nhà thầu vừa chậm tiến độ thi công 15 ngày, vừa gửi công văn xin gia hạn lịch nghiệm thu.",
            useAi: true,
            apiKey: "unit-test-only",
            fetcher: fakeFetchReject,
        });

        expect(rejectedFlashCalls).toBe(0);
        expect(gated.output.outcome).toBe("GUILTY_SANCTIONED");
        expect(gated.output.applicableFine).toEqual({ min: 5_000_000, max: 10_000_000 });
        expect(gated.usage.llmCalls).toBe(1);
        expect(gated.usage.decisionInputTokens).toBe(140);
        expect(gated.usage.modelUsed).toBe("gemini-decision-1");
    });

    it("detects Vietnamese organization entities with Unicode boundaries (hợp tác xã, ngân hàng) while keeping hộ kinh doanh cá nhân as individual", async () => {
        const draft = [
            "Nghị định xử phạt vi phạm hành chính",
            "Điều 1. Nguyên tắc xử phạt",
            "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
            "Điều 2. Xử phạt chậm báo cáo",
            "1. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân chậm nộp báo cáo định kỳ từ 05 ngày đến 15 ngày.",
        ].join("\n");

        const coopRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Hợp tác xã Minh Long chậm nộp báo cáo định kỳ 10 ngày.",
        });

        expect(coopRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(coopRes.verdict.applicableFine).toEqual({ min: 10_000_000, max: 20_000_000 });

        const bankRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ngân hàng TMCP Bắc Á chậm nộp báo cáo định kỳ 10 ngày.",
        });

        expect(bankRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(bankRes.verdict.applicableFine).toEqual({ min: 10_000_000, max: 20_000_000 });

        const householdRes = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ông C là hộ kinh doanh cá nhân chậm nộp báo cáo định kỳ 10 ngày.",
        });

        expect(householdRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(householdRes.verdict.applicableFine).toEqual({ min: 5_000_000, max: 10_000_000 });
    });

    it("resolves secondary violations directly via Channel 3 per-clause noul answers with 0 output tokens and strips criteria from noul questions", async () => {
        const contractDraft = [
            "Hợp đồng thi công xây dựng số 08/2026/HĐXD",
            "Điều 1. Vi phạm tiến độ thi công",
            "1. Phạt tiền từ 5.000.000 đồng đến 10.000.000 đồng đối với cá nhân và tổ chức chậm tiến độ thi công từ 10 ngày đến 30 ngày.",
            "Điều 2. Vi phạm chất lượng vật tư",
            "1. Phạt tiền từ 15.000.000 đồng đến 25.000.000 đồng đối với cá nhân và tổ chức sử dụng vật tư không bảo đảm chất lượng theo hồ sơ thiết kế.",
            "Điều 3. Hiệu lực thi hành",
            "1. Hợp đồng này có hiệu lực thi hành kể từ ngày 01 tháng 01 năm 2026.",
        ].join("\n");

        let flashCalls = 0;

        const fakeFetchDirect = (async (url: string, init?: RequestInit) => {
            if (url.includes("/v1beta/decisions")) {
                const body = JSON.parse(String(init?.body ?? "{}")) as {
                    questions?: Record<string, Record<string, unknown>>;
                };

                for (const question of Object.values(body.questions ?? {})) {
                    if (question.type === "noul") {
                        expect("criteria" in question).toBe(false);
                    }
                }

                return new Response(
                    JSON.stringify({
                        answers: {
                            missed_secondary_violation: { type: "noul", noul: 0.94, confidence: 0.95 },
                            p0: { type: "noul", noul: 0.96, confidence: 0.96 },
                        },
                        usage: { total_input_tokens: 390, total_output_tokens: 0, total_tokens: 390 },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            flashCalls += 1;

            return new Response("{}", { status: 500 });
        }) as unknown as typeof fetch;

        const directRes = await runItdLiveJudge({
            caseId: "UNIT-JG-SEC-DIRECT",
            draftContent: contractDraft,
            scenario: "Nhà thầu vừa chậm tiến độ thi công 15 ngày, vừa tự ý tráo chủng loại thép sai bản vẽ kỹ thuật.",
            useAi: true,
            apiKey: "unit-test-only",
            fetcher: fakeFetchDirect,
        });

        expect(flashCalls).toBe(0);
        expect(directRes.output.outcome).toBe("GUILTY_SANCTIONED");
        expect(directRes.output.applicableFine).toEqual({ min: 20_000_000, max: 35_000_000 });
        expect(directRes.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 1")).toBe(true);
        expect(directRes.output.citations.some((c) => c.provisionRef === "Khoản 1 Điều 2")).toBe(true);
        expect(directRes.usage.llmCalls).toBe(1);
        expect(directRes.usage.outputTokens).toBe(0);
        expect(directRes.usage.decisionInputTokens).toBe(390);
        expect(directRes.usage.modelUsed).toBe("gemini-decision-1");
    });
});
