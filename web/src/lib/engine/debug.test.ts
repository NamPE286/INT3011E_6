import { describe, expect, it } from "bun:test";
import { runLocalDebugSimulation } from "./debug";

describe("runLocalDebugSimulation", () => {
    it("detects LG001 inverted fine on Clause 3 without bleeding from Clause 1", async () => {
        const draft = [
            "Dự thảo Nghị định giao thông",
            "Điều 3. Xử phạt vi phạm quy định về tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến 10 km/h.",
            "2. Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ quy định từ 15 km/h đến 20 km/h.",
            "3. Phạt tiền từ 6.000.000 đồng đến 4.000.000 đồng đối với hành vi chạy quá tốc độ quy định từ 20 km/h đến 35 km/h.",
        ].join("\n");

        const result = await runLocalDebugSimulation({
            content: draft,
            scenario: "Cá nhân điều khiển xe chạy quá tốc độ 28 km/h.",
        });

        expect(result.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(result.verdict.applicableFine).toBeNull();
        expect(result.verdict.exploitedDefects.some((d) => d.code === "LG001")).toBe(true);
    });

    it("detects LP006 when org conversion clause is absent, and doubles fine when present", async () => {
        const withoutConversion = [
            "Dự thảo Nghị định",
            "Điều 3. Xử phạt tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 05 km/h đến dưới 10 km/h.",
        ].join("\n");

        const resWithout = await runLocalDebugSimulation({
            content: withoutConversion,
            scenario: "Công ty vận tải X điều khiển xe chạy quá tốc độ 8 km/h.",
        });

        expect(resWithout.verdict.outcome).toBe("ACQUITTED_LOOPHOLE");
        expect(resWithout.verdict.applicableFine).toBeNull();
        expect(resWithout.verdict.exploitedDefects.some((d) => d.code === "LP006")).toBe(true);

        const withConversion = [
            "Dự thảo Nghị định",
            "Điều 1. Nguyên tắc quy đổi",
            "1. Đối với cùng một hành vi vi phạm hành chính thì mức phạt tiền đối với tổ chức bằng 02 lần mức phạt tiền đối với cá nhân.",
            "Điều 3. Xử phạt tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân điều khiển xe chạy quá tốc độ từ 05 km/h đến dưới 10 km/h.",
        ].join("\n");

        const resWith = await runLocalDebugSimulation({
            content: withConversion,
            scenario: "Công ty vận tải X có hành vi điều khiển xe chạy quá tốc độ 8 km/h.",
        });

        expect(resWith.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(resWith.verdict.applicableFine).toEqual({ min: 1_600_000, max: 2_000_000 });
        expect(resWith.verdict.exploitedDefects.some((d) => d.code === "LP006")).toBe(false);
    });

    it("supports multi-domain units like kilôgam (LP003) and giấy tờ giả (LG002)", async () => {
        const draftBlhs305 = [
            "Bộ luật Hình sự",
            "Điều 305. Tội chế tạo vật liệu nổ",
            "2. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 03 năm đến 10 năm:",
            "b) Thuốc nổ các loại từ 10 kilôgam đến 30 kilôgam.",
            "3. Phạm tội thuộc một trong các trường hợp sau đây, thì bị phạt tù từ 07 năm đến 15 năm:",
            "a) Thuốc nổ các loại từ trên 31 kilôgam đến 100 kilôgam.",
        ].join("\n");

        const res305 = await runLocalDebugSimulation({
            content: draftBlhs305,
            scenario: "Đối tượng X chế tạo trái phép 30,5 kilôgam thuốc nổ.",
        });

        expect(res305.verdict.outcome).toBe("ACQUITTED_LOOPHOLE");
        expect(res305.verdict.exploitedDefects.some((d) => d.code === "LP003")).toBe(true);

        const draftBlhs359 = [
            "Bộ luật Hình sự",
            "Điều 359. Tội giả mạo trong công tác",
            "2. Phạm tội thuộc một trong các trường hợp sau đây:",
            "c) Làm, cấp giấy tờ giả với số lượng từ 02 giấy tờ giả đến 05 giấy tờ giả.",
            "3. Phạm tội thuộc một trong các trường hợp sau đây:",
            "a) Làm, cấp giấy tờ giả với số lượng từ 05 giấy tờ giả đến 10 giấy tờ giả.",
        ].join("\n");

        const res359 = await runLocalDebugSimulation({
            content: draftBlhs359,
            scenario: "Bị cáo Y làm giả 05 giấy tờ giả trong hoạt động công vụ.",
        });

        expect(res359.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(res359.verdict.exploitedDefects.some((d) => d.code === "LG002")).toBe(true);
    });

    it("disambiguates vehicles and matches Vietnamese legal synonyms for red-light violations", async () => {
        const draft168 = [
            "Nghị định số 168/2024/NĐ-CP",
            "Điều 2. Xử phạt người điều khiển xe ô tô",
            "3. Phạt tiền từ 18.000.000 đồng đến 20.000.000 đồng đối với người điều khiển xe ô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
            "Điều 3. Xử phạt người điều khiển xe mô tô",
            "2. Phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với người điều khiển xe mô tô không chấp hành hiệu lệnh của đèn tín hiệu giao thông.",
        ].join("\n");

        const carRes = await runLocalDebugSimulation({
            content: draft168,
            scenario: "Anh H lái xe hơi vượt đèn đỏ tại ngã tư.",
        });

        expect(carRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(carRes.verdict.applicableFine).toEqual({ min: 18_000_000, max: 20_000_000 });

        const bikeRes = await runLocalDebugSimulation({
            content: draft168,
            scenario: "Chị M đi xe máy vượt đèn đỏ tại giao lộ.",
        });

        expect(bikeRes.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(bikeRes.verdict.applicableFine).toEqual({ min: 4_000_000, max: 6_000_000 });
    });

    it("detects deterministic deontic conflict (Cấm vs Cho phép)", async () => {
        const draftDeontic = [
            "Dự thảo Nghị định",
            "Điều 1. Quy định lưu thông xe tự hành trên đường cao tốc",
            "1. Nghiêm cấm cá nhân điều khiển xe tự hành đi vào đường cao tốc; trường hợp vi phạm bị phạt tiền từ 4.000.000 đồng đến 6.000.000 đồng đối với cá nhân.",
            "2. Cho phép cá nhân điều khiển xe tự hành đi vào đường cao tốc.",
        ].join("\n");

        const res = await runLocalDebugSimulation({
            content: draftDeontic,
            scenario: "Anh K điều khiển xe tự hành đi vào đường cao tốc.",
        });

        expect(res.verdict.outcome).toBe("CONFLICT_AMBIGUOUS");
        expect(res.verdict.applicableFine).toBeNull();
        expect(res.verdict.exploitedDefects.some((d) => d.code === "DEONTIC_CONFLICT")).toBe(true);
    });

    it("returns NOT_COVERED when measurement is below minimum threshold", async () => {
        const draft = [
            "Dự thảo Nghị định",
            "Điều 3. Xử phạt tốc độ",
            "1. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với cá nhân chạy quá tốc độ từ 05 km/h đến dưới 10 km/h.",
        ].join("\n");

        const res = await runLocalDebugSimulation({
            content: draft,
            scenario: "Anh D điều khiển xe chạy quá tốc độ 3 km/h.",
        });

        expect(res.verdict.outcome).toBe("NOT_COVERED");
        expect(res.verdict.applicableFine).toBeNull();
    });

    it("uses neuro-symbolic AI clause mapping fallback when useAi is true and deterministic matching finds nothing", async () => {
        const draft = [
            "Dự thảo Nghị định",
            "Điều 1. Xử phạt hành vi đặc thù",
            "1. Phạt tiền từ 3.000.000 đồng đến 5.000.000 đồng đối với hành vi vận chuyển gia súc không có giấy kiểm dịch.",
        ].join("\n");

        let callCount = 0;

        const fakeFetch = (async () => {
            callCount += 1;

            if (callCount === 1) {
                return new Response(
                    JSON.stringify({
                        output_text: JSON.stringify({
                            matchedProvisionRefs: ["Khoản 1 Điều 1"],
                        }),
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }

            return new Response(
                JSON.stringify({
                    output_text: JSON.stringify({
                        summary: "Đủ căn cứ xử phạt từ 3.000.000đ đến 5.000.000đ.",
                        judicialReasoning: ["Khớp Khoản 1 Điều 1 về kiểm dịch."],
                    }),
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const res = await runLocalDebugSimulation({
            content: draft,
            scenario: "Ông T chở đàn bò qua trạm mà thiếu chứng nhận thú y.",
            useAi: true,
            apiKey: "sk-test-key",
            fetcher: fakeFetch,
        });

        expect(res.method).toBe("LEAN_PLUS_AI");
        expect(res.verdict.outcome).toBe("GUILTY_SANCTIONED");
        expect(res.verdict.applicableFine).toEqual({ min: 3_000_000, max: 5_000_000 });
    });
});
