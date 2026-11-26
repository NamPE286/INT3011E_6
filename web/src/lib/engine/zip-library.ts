import { createZipArchive, unzipArchive } from "./zip";

export type LocalLibraryImportItem = {
    title: string;
    documentNumber: string;
    documentType: string;
    agency: string | null;
    content: string;
};

type ManifestItem = {
    file: string;
    title?: string;
    documentNumber?: string;
    documentType?: string | null;
    agency?: string | null;
};

const TEXT_LAW_EXTENSIONS = new Set([".txt", ".md", ".luat"]);
const DOC_NUMBER_REGEX = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });

export async function extractLawsFromZipArchive(
    zipBytes: Uint8Array,
): Promise<{ laws: LocalLibraryImportItem[]; skipped: string[] }> {
    const entries = await unzipArchive(zipBytes);
    const manifestMap = parseManifestMap(entries);
    const laws: LocalLibraryImportItem[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
        const lowerPath = entry.path.toLowerCase();
        const basename = entry.path.split("/").pop() ?? entry.path;

        if (basename.toLowerCase() === "manifest.json") {
            continue;
        }

        const extIndex = lowerPath.lastIndexOf(".");
        const ext = extIndex >= 0 ? lowerPath.slice(extIndex) : "";

        if (ext === ".json") {
            const parsedJsonLaws = parseJsonLawFile(entry.bytes, entry.path);

            if (parsedJsonLaws.length > 0) {
                laws.push(...parsedJsonLaws);
            } else {
                skipped.push(entry.path);
            }

            continue;
        }

        if (!TEXT_LAW_EXTENSIONS.has(ext)) {
            skipped.push(entry.path);
            continue;
        }

        const text = UTF8_DECODER.decode(entry.bytes).trim();

        if (!text) {
            skipped.push(entry.path);
            continue;
        }

        const meta = manifestMap.get(entry.path) ?? manifestMap.get(basename);
        laws.push(inferLawMetadata(basename, text, laws.length + 1, meta));
    }

    return { laws, skipped };
}

function parseManifestMap(entries: readonly { path: string; bytes: Uint8Array }[]): Map<string, ManifestItem> {
    const map = new Map<string, ManifestItem>();
    const manifestEntry = entries.find((item) => (item.path.split("/").pop() ?? "").toLowerCase() === "manifest.json");

    if (!manifestEntry) {
        return map;
    }

    try {
        const parsed = JSON.parse(UTF8_DECODER.decode(manifestEntry.bytes)) as unknown;
        const list = Array.isArray(parsed)
            ? parsed
            : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { laws?: unknown }).laws)
              ? (parsed as { laws: unknown[] }).laws
              : [];

        for (const item of list) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const record = item as Record<string, unknown>;
            const file = typeof record.file === "string" ? record.file.trim() : "";

            if (!file) {
                continue;
            }

            map.set(file, {
                file,
                title: typeof record.title === "string" ? record.title.trim() : undefined,
                documentNumber: typeof record.documentNumber === "string" ? record.documentNumber.trim() : undefined,
                documentType: typeof record.documentType === "string" ? record.documentType.trim() : null,
                agency: typeof record.agency === "string" ? record.agency.trim() : null,
            });
        }
    } catch {
        return map;
    }

    return map;
}

function parseJsonLawFile(bytes: Uint8Array, path: string): LocalLibraryImportItem[] {
    try {
        const parsed = JSON.parse(UTF8_DECODER.decode(bytes)) as unknown;
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const out: LocalLibraryImportItem[] = [];

        for (const raw of items) {
            if (typeof raw !== "object" || raw === null) {
                continue;
            }

            const record = raw as Record<string, unknown>;
            const content = typeof record.content === "string" ? record.content.trim() : "";

            if (!content) {
                continue;
            }

            const title = typeof record.title === "string" && record.title.trim()
                ? record.title.trim()
                : path.replace(/\.[^.]+$/, "");
            const documentNumber = typeof record.documentNumber === "string" && record.documentNumber.trim()
                ? record.documentNumber.trim()
                : `LIB-${String(out.length + 1).padStart(2, "0")}/2026`;

            out.push({
                title,
                documentNumber,
                documentType: typeof record.documentType === "string" && record.documentType.trim()
                    ? record.documentType.trim()
                    : "Luật",
                agency: typeof record.agency === "string" && record.agency.trim() ? record.agency.trim() : null,
                content,
            });
        }

        return out;
    } catch {
        return [];
    }
}

function inferLawMetadata(
    filename: string,
    content: string,
    index: number,
    manifest: ManifestItem | undefined,
): LocalLibraryImportItem {
    const cleanBase = filename.replace(/\.[^.]+$/, "").trim();
    const firstLines = content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10);
    const headerText = firstLines.join("\n");

    const numberMatch = DOC_NUMBER_REGEX.exec(headerText) ?? DOC_NUMBER_REGEX.exec(cleanBase.replace(/-/g, "/"));
    const documentNumber = manifest?.documentNumber || numberMatch?.[1] || `LIB-${String(index).padStart(2, "0")}/2026`;

    let title = manifest?.title || "";

    if (!title) {
        const firstLine = firstLines[0] ?? cleanBase;
        const cleanedLine = firstLine.replace(/^#+\s*/, "").replace(/^Tiêu đề:\s*/iu, "").trim();
        title = /^(?:Điều|Chương)\s+\d+/iu.test(cleanedLine) ? cleanBase : cleanedLine.slice(0, 180);
    }

    const docTypeHint = `${manifest?.documentType ?? ""} ${title} ${documentNumber}`;
    let documentType = manifest?.documentType ?? null;

    if (!documentType) {
        if (/Bộ luật/iu.test(docTypeHint)) {
            documentType = "Bộ luật";
        } else if (/Nghị định|NĐ-CP/iu.test(docTypeHint)) {
            documentType = "Nghị định";
        } else if (/Thông tư|TT-/iu.test(docTypeHint)) {
            documentType = "Thông tư";
        } else if (/Nghị quyết|NQ/iu.test(docTypeHint)) {
            documentType = "Nghị quyết";
        } else {
            documentType = "Luật";
        }
    }

    return {
        title: title || cleanBase,
        documentNumber,
        documentType,
        agency: manifest?.agency ?? null,
        content,
    };
}

export function buildSampleLibraryZip(): Uint8Array {
    const manifest = {
        laws: [
            {
                file: "36-2024-QH15-Luat-TTATGTDB.txt",
                title: "Luật Trật tự, an toàn giao thông đường bộ",
                documentNumber: "36/2024/QH15",
                documentType: "Luật",
                agency: "Quốc hội",
            },
            {
                file: "168-2024-ND-CP-Xu-phat-ATGT.txt",
                title: "Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông",
                documentNumber: "168/2024/NĐ-CP",
                documentType: "Nghị định",
                agency: "Chính phủ",
            },
        ],
    };

    const law1 = `Luật Trật tự, an toàn giao thông đường bộ

Điều 1. Giải thích từ ngữ
1. Điểm giấy phép lái xe là thang gồm 12 điểm trong 01 năm để theo dõi việc chấp hành pháp luật về trật tự, an toàn giao thông đường bộ của người lái xe.
2. Xe tự hành là phương tiện giao thông đường bộ có hệ thống điều khiển tự động vận hành không cần tác động trực tiếp liên tục của người lái.
3. Hệ thống hỗ trợ lái là tập hợp cảm biến và phần mềm cảnh báo, hỗ trợ kiểm soát tốc độ và làn đường cho người điều khiển.`;

    const law2 = `Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông

Điều 1. Giải thích từ ngữ
1. Phạt nguội là hình thức xử phạt vi phạm hành chính thông qua kết quả thu thập được bằng phương tiện, thiết bị kỹ thuật nghiệp vụ.
2. Hệ thống camera giám sát là thiết bị ghi nhận hình ảnh, tốc độ phương tiện tham gia giao thông đường bộ phục vụ xử lý vi phạm.`;

    return createZipArchive([
        { path: "manifest.json", content: JSON.stringify(manifest, null, 2) },
        { path: "36-2024-QH15-Luat-TTATGTDB.txt", content: law1 },
        { path: "168-2024-ND-CP-Xu-phat-ATGT.txt", content: law2 },
    ]);
}
