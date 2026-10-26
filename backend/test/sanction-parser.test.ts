import { describe, expect, it } from "bun:test";
import { allowsWarning, parseEffects, parseFines, parseRemedialMeasures } from "../src/modules/violations/sanction.parser";

describe("parseFines", () => {
    it("reads a fine range", () => {
        expect(parseFines("Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:")).toEqual([
            { min: 400_000, max: 600_000, subject: null },
        ]);
    });

    it("keeps separate ranges for individuals and organizations", () => {
        expect(parseFines("Phạt tiền từ 2.000.000 đồng đến 4.000.000 đồng đối với cá nhân, từ 4.000.000 đồng đến 8.000.000 đồng đối với tổ chức là chủ xe ô tô")).toEqual([
            { min: 2_000_000, max: 4_000_000, subject: "INDIVIDUAL" },
            { min: 4_000_000, max: 8_000_000, subject: "ORGANIZATION" },
        ]);
    });

    it("reads a single amount and ignores text without a fine", () => {
        expect(parseFines("Phạt tiền 500.000 đồng đối với hành vi sau:")).toEqual([{ min: 500_000, max: 500_000, subject: null }]);
        expect(parseFines("Người điều khiển xe phải giảm tốc độ.")).toEqual([]);
    });

    it("recognizes a warning alternative", () => {
        expect(allowsWarning("Phạt cảnh cáo hoặc phạt tiền từ 100.000 đồng đến 200.000 đồng")).toBe(true);
    });
});

describe("parseEffects", () => {
    it("reads licence suspension with its duration", () => {
        expect(parseEffects("Thực hiện hành vi quy định tại điểm a khoản 5 Điều này bị tước quyền sử dụng Giấy phép lái xe từ 01 tháng đến 03 tháng;")).toEqual([
            expect.objectContaining({ effectType: "LICENSE_SUSPENSION", durationMin: 1, durationMax: 3, durationUnit: "MONTH" }),
        ]);
    });

    it("reads point deduction in both word orders", () => {
        expect(parseEffects("bị trừ điểm giấy phép lái xe 04 điểm")[0]).toMatchObject({ effectType: "LICENSE_POINT_DEDUCTION", points: 4 });
        expect(parseEffects("bị trừ 06 điểm giấy phép lái xe")[0]).toMatchObject({ effectType: "LICENSE_POINT_DEDUCTION", points: 6 });
    });

    it("separates confiscation from a procedural hold", () => {
        expect(parseEffects("bị tịch thu phương tiện")[0]).toMatchObject({ effectType: "VEHICLE_CONFISCATION" });
        expect(parseEffects("Tạm giữ phương tiện đến 07 ngày trước khi ra quyết định xử phạt")).toEqual([]);
    });
});

describe("parseRemedialMeasures", () => {
    it("keeps each remedial order", () => {
        expect(parseRemedialMeasures("Thực hiện hành vi quy định tại điểm a khoản 1 Điều này buộc phải khôi phục lại tình trạng ban đầu đã bị thay đổi do vi phạm hành chính gây ra;")).toEqual([
            "buộc phải khôi phục lại tình trạng ban đầu đã bị thay đổi do vi phạm hành chính gây ra",
        ]);
    });
});
