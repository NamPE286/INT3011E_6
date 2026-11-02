import { describe, expect, it } from "bun:test";
import { calculateSimilarity } from "../src/modules/vocabulary/vocabulary.similarity";

const AMBIGUOUS_THRESHOLD = 0.75;

describe("calculateSimilarity", () => {
    it("keeps labels that differ by a whole syllable apart, however few letters change", () => {
        expect(calculateSimilarity("xe mô tô", "xe ô tô")).toBeLessThan(AMBIGUOUS_THRESHOLD);
        expect(calculateSimilarity("người điều khiển xe mô tô", "người điều khiển xe ô tô")).toBeLessThan(AMBIGUOUS_THRESHOLD);
    });

    it("still treats an added word or lost diacritics as the same label", () => {
        expect(calculateSimilarity("chạy xe quá tốc độ", "chạy quá tốc độ")).toBeGreaterThanOrEqual(AMBIGUOUS_THRESHOLD);
        expect(calculateSimilarity("chay qua toc do", "chạy quá tốc độ")).toBeGreaterThanOrEqual(0.95);
    });
});
