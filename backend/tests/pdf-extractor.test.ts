/**
 * Real unpdf regression: run separately with
 *   bun test tests/pdf-extractor.test.ts
 * Do not import processing.test.ts here: that file globally mocks pdf-extractor.
 */
import { expect, test } from "bun:test";
import { extractPdfText } from "../src/modules/processing/pdf-extractor";

const fixture = new URL("../test/fixtures/sample.pdf", import.meta.url);

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("extracts real PDF text without detaching or modifying source bytes", async () => {
  const original = await Bun.file(fixture).arrayBuffer();
  const originalSize = original.byteLength;
  const originalHash = await sha256(original);
  expect(originalSize).toBe(45_230);

  const pages = await extractPdfText(original);
  expect(pages.length).toBeGreaterThan(0);
  expect(original.byteLength).toBe(originalSize);
  expect(await sha256(original)).toBe(originalHash);
});
