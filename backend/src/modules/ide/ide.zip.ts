const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

const MAX_ZIP_ENTRIES = 50;
const MAX_ENTRY_BYTES = 500_000;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;

export type ZipEntry = {
    path: string;
    bytes: Uint8Array;
};

export type ZipInputEntry = {
    path: string;
    content: string | Uint8Array;
};

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: false });

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);

    for (let i = 0; i < 256; i += 1) {
        let c = i;

        for (let bit = 0; bit < 8; bit += 1) {
            c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }

        table[i] = c >>> 0;
    }

    return table;
}

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    for (let idx = 0; idx < bytes.length; idx += 1) {
        crc = CRC32_TABLE[(crc ^ bytes[idx]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function isSafeZipPath(rawPath: string): boolean {
    if (!rawPath || rawPath.startsWith("/") || rawPath.startsWith("\\")) {
        return false;
    }

    const normalized = rawPath.replace(/\\/g, "/");
    const segments = normalized.split("/");

    if (segments.some((seg) => seg === "..")) {
        return false;
    }

    if (normalized.startsWith("__MACOSX/") || normalized.endsWith("/")) {
        return false;
    }

    const basename = segments[segments.length - 1] ?? "";

    if (!basename || basename.startsWith("._") || basename === ".DS_Store") {
        return false;
    }

    return true;
}

function findEndOfCentralDir(view: DataView, byteLength: number): number {
    const minOffset = Math.max(0, byteLength - 65_557);

    for (let offset = byteLength - 22; offset >= minOffset; offset -= 1) {
        if (view.getUint32(offset, true) === END_OF_CENTRAL_DIR_SIG) {
            return offset;
        }
    }

    return -1;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
    const copy = new Uint8Array(compressed.byteLength);
    copy.set(compressed);
    const stream = new Response(copy).body?.pipeThrough(new DecompressionStream("deflate-raw"));

    if (!stream) {
        throw new Error("Không thể khởi tạo luồng giải nén DEFLATE.");
    }

    const buffer = await new Response(stream).arrayBuffer();

    return new Uint8Array(buffer);
}

/**
 * Unpacks a standard ZIP archive (STORE and DEFLATE) in memory without external dependencies.
 */
export async function unzipArchive(data: Uint8Array): Promise<ZipEntry[]> {
    if (data.byteLength < 22) {
        throw new Error("Tệp .zip không hợp lệ hoặc quá ngắn.");
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const eocdOffset = findEndOfCentralDir(view, data.byteLength);

    if (eocdOffset < 0) {
        throw new Error("Không tìm thấy cấu trúc End of Central Directory trong tệp .zip.");
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    if (centralDirOffset >= data.byteLength) {
        throw new Error("Vị trí Central Directory trong tệp .zip không hợp lệ.");
    }

    const entries: ZipEntry[] = [];
    let cursor = centralDirOffset;
    let totalBytes = 0;

    for (let idx = 0; idx < totalEntries; idx += 1) {
        if (cursor + 46 > data.byteLength || view.getUint32(cursor, true) !== CENTRAL_DIR_HEADER_SIG) {
            throw new Error("Cấu trúc Central Directory trong tệp .zip bị lỗi.");
        }

        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const localHeaderOffset = view.getUint32(cursor + 42, true);

        const nameStart = cursor + 46;
        const nameEnd = nameStart + nameLength;

        if (nameEnd > data.byteLength) {
            throw new Error("Tên tệp trong gói .zip vượt quá giới hạn bộ nhớ.");
        }

        const rawPath = UTF8_DECODER.decode(data.subarray(nameStart, nameEnd));
        cursor = nameEnd + extraLength + commentLength;

        if (!isSafeZipPath(rawPath)) {
            continue;
        }

        if (entries.length >= MAX_ZIP_ENTRIES) {
            throw new Error(`Gói .zip vượt quá giới hạn tối đa ${MAX_ZIP_ENTRIES} tệp.`);
        }

        if (uncompressedSize > MAX_ENTRY_BYTES) {
            throw new Error(`Tệp "${rawPath}" vượt quá giới hạn ${MAX_ENTRY_BYTES} byte.`);
        }

        if (localHeaderOffset + 30 > data.byteLength || view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIG) {
            throw new Error(`Local header của tệp "${rawPath}" không hợp lệ.`);
        }

        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;

        if (dataEnd > data.byteLength) {
            throw new Error(`Dữ liệu nén của tệp "${rawPath}" bị cắt cụt.`);
        }

        const compressedSlice = data.subarray(dataStart, dataEnd);
        let bytes: Uint8Array;

        if (method === 0) {
            bytes = new Uint8Array(compressedSlice);
        } else if (method === 8) {
            bytes = await inflateRaw(compressedSlice);
        } else {
            throw new Error(`Phương thức nén (${method}) của tệp "${rawPath}" chưa được hỗ trợ.`);
        }

        if (bytes.byteLength > MAX_ENTRY_BYTES) {
            throw new Error(`Tệp "${rawPath}" sau giải nén vượt quá ${MAX_ENTRY_BYTES} byte.`);
        }

        totalBytes += bytes.byteLength;

        if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            throw new Error("Tổng dung lượng sau giải nén vượt quá giới hạn 10 MB.");
        }

        entries.push({ path: rawPath.replace(/\\/g, "/"), bytes });
    }

    return entries;
}

/**
 * Packages files into a standard uncompressed (STORE) ZIP archive with UTF-8 filenames.
 */
export function createZipArchive(entries: readonly ZipInputEntry[]): Uint8Array {
    const localChunks: Uint8Array[] = [];
    const centralChunks: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = UTF8_ENCODER.encode(entry.path);
        const dataBytes = typeof entry.content === "string" ? UTF8_ENCODER.encode(entry.content) : entry.content;
        const checksum = crc32(dataBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, LOCAL_FILE_HEADER_SIG, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, 0, true);
        localView.setUint16(12, 0, true);
        localView.setUint32(14, checksum, true);
        localView.setUint32(18, dataBytes.length, true);
        localView.setUint32(22, dataBytes.length, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, CENTRAL_DIR_HEADER_SIG, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, 0, true);
        centralView.setUint16(14, 0, true);
        centralView.setUint32(16, checksum, true);
        centralView.setUint32(20, dataBytes.length, true);
        centralView.setUint32(24, dataBytes.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);

        localChunks.push(localHeader, dataBytes);
        centralChunks.push(centralHeader);
        offset += localHeader.length + dataBytes.length;
    }

    const centralDirSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, END_OF_CENTRAL_DIR_SIG, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, entries.length, true);
    eocdView.setUint16(10, entries.length, true);
    eocdView.setUint32(12, centralDirSize, true);
    eocdView.setUint32(16, offset, true);
    eocdView.setUint16(20, 0, true);

    const totalSize = offset + centralDirSize + eocd.length;
    const output = new Uint8Array(totalSize);
    let writePos = 0;

    for (const chunk of localChunks) {
        output.set(chunk, writePos);
        writePos += chunk.length;
    }

    for (const chunk of centralChunks) {
        output.set(chunk, writePos);
        writePos += chunk.length;
    }

    output.set(eocd, writePos);

    return output;
}
