import { describe, expect, it } from "bun:test";
import { IncrementalLlmCache } from "./engine/llm-incremental";
import {
    LEXIDE_META_DIR,
    readAllFilesFromDirectory,
    readLexideJsonFromDirectory,
    writeLexideJsonToDirectory,
    type DirectoryHandleLike,
} from "./local-fs";

function createMemoryDirectory(name = "root"): DirectoryHandleLike {
    const dirs = new Map<string, DirectoryHandleLike>();
    const files = new Map<string, string>();

    const handle: DirectoryHandleLike = {
        name,
        kind: "directory",
        async *entries() {
            for (const [dName, dHandle] of dirs.entries()) {
                yield [dName, dHandle];
            }

            for (const [fName, fText] of files.entries()) {
                yield [
                    fName,
                    {
                        name: fName,
                        kind: "file",
                        async getFile() {
                            return new File([fText], fName, { type: "text/plain" });
                        },
                        async createWritable() {
                            let buf = "";

                            return {
                                async write(data: string) {
                                    buf += data;
                                },
                                async close() {
                                    files.set(fName, buf);
                                },
                            };
                        },
                    },
                ];
            }
        },
        async getDirectoryHandle(subName: string, options?: { create?: boolean }) {
            const existing = dirs.get(subName);

            if (existing) {
                return existing;
            }

            if (options?.create) {
                const created = createMemoryDirectory(subName);
                dirs.set(subName, created);

                return created;
            }

            throw new Error(`Directory not found: ${subName}`);
        },
        async getFileHandle(fileName: string, options?: { create?: boolean }) {
            if (!files.has(fileName) && !options?.create) {
                throw new Error(`File not found: ${fileName}`);
            }

            return {
                name: fileName,
                kind: "file",
                async getFile() {
                    return new File([files.get(fileName) ?? ""], fileName, { type: "text/plain" });
                },
                async createWritable() {
                    let buf = "";

                    return {
                        async write(data: string) {
                            buf += data;
                        },
                        async close() {
                            files.set(fileName, buf);
                        },
                    };
                },
            };
        },
        async removeEntry(entryName: string) {
            files.delete(entryName);
            dirs.delete(entryName);
        },
    };

    return handle;
}

describe(".lexide/ folder persistence & IncrementalLlmCache serialization", () => {
    it("serializes and restores IncrementalLlmCache safely", () => {
        const cache = new IncrementalLlmCache();
        cache.neuroSymbolicCache.set("gemini-3.5-flash-lite::abc123", {
            partitions: [],
            semanticDefects: [
                {
                    kind: "PROCEDURAL_GAP",
                    severity: "warning",
                    title: "Thiếu thời hạn",
                    message: "Thiếu thời hạn xử lý.",
                    suggestion: "Bổ sung thời hạn.",
                    quote: "xử lý vi phạm",
                    secondQuote: null,
                    startOffset: 0,
                    endOffset: 10,
                    line: 1,
                    provisionRef: "Điều 1",
                },
            ],
        });
        cache.refDecisionCache.set("1:2:test", null);

        const json = cache.toJSON();
        const restored = new IncrementalLlmCache();

        expect(restored.loadFromJSON(json)).toBe(true);
        expect(restored.neuroSymbolicCache.get("gemini-3.5-flash-lite::abc123")?.semanticDefects.length).toBe(1);
        expect(restored.refDecisionCache.has("1:2:test")).toBe(true);
        expect(restored.loadFromJSON({ version: 999 })).toBe(false);
    });

    it("writes and reads .lexide/cache.json and .lexide/workspace.json while ignoring .lexide/ in law file scans", async () => {
        const root = createMemoryDirectory("luat-giao-thong");
        const lawHandle = await root.getFileHandle("du-thao.txt", { create: true });
        const writable = await lawHandle.createWritable();
        await writable.write("Dự thảo Luật\n\nĐiều 1. Phạm vi\n1. Áp dụng chung.");
        await writable.close();

        await writeLexideJsonToDirectory(root, "workspace.json", {
            version: 1,
            updatedAt: "2026-11-26T00:00:00Z",
            openTabs: ["du-thao.txt"],
            activeFilePath: "du-thao.txt",
            lastDebugScenario: "Test",
            commits: [],
        });

        const readBack = await readLexideJsonFromDirectory<{ activeFilePath: string }>(root, "workspace.json");
        expect(readBack?.activeFilePath).toBe("du-thao.txt");

        const scanned = await readAllFilesFromDirectory(root);
        expect(scanned.length).toBe(1);
        expect(scanned[0].path).toBe("du-thao.txt");
        expect(scanned.some((f) => f.path.includes(LEXIDE_META_DIR))).toBe(false);
    });
});
