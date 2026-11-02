import { describe, expect, it } from "bun:test";
import { cleanRuleText } from "../src/modules/violations/rule.nodes";

describe("cleanRuleText", () => {
    it("drops the closing mark of quoted new wording and the punctuation the instruction puts after it", () => {
        expect(cleanRuleText("Không đội mũ bảo hiểm khi điều khiển xe chạy trên đường bộ.”.")).toBe("Không đội mũ bảo hiểm khi điều khiển xe chạy trên đường bộ.");
        expect(cleanRuleText("“a) Dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định;”")).toBe("Dừng xe, đỗ xe trên đường cao tốc không đúng nơi quy định;");
    });

    it("keeps the text's own final punctuation when there is no quote", () => {
        expect(cleanRuleText("a) Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;")).toBe("Không chấp hành hiệu lệnh của đèn tín hiệu giao thông;");
    });
});
