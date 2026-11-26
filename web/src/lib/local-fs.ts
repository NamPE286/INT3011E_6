import type { LocalWorkspaceFile } from "$lib/engine/local-workspace";

export type DirectoryHandleLike = {
    name: string;
    kind: "directory";
    entries: () => AsyncIterableIterator<[string, FileSystemEntryLike]>;
    getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandleLike>;
    getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
    removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
    queryPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
    requestPermission?: (descriptor: { mode: "read" | "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
};

type FileHandleLike = {
    name: string;
    kind: "file";
    getFile: () => Promise<File>;
    createWritable: () => Promise<{
        write: (data: string) => Promise<void>;
        close: () => Promise<void>;
    }>;
};

type FileSystemEntryLike = DirectoryHandleLike | FileHandleLike;

export const LEXIDE_META_DIR = ".lexide";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".luat", ".json"]);
const IGNORED_DIRS = new Set([".git", ".lexide", "node_modules", ".svelte-kit", "dist", "build"]);
const IDB_NAME = "lexide-fs-db";
const IDB_STORE = "handles";
const IDB_KEY = "workspace-dir";
const VIRTUAL_STORAGE_KEY = "lexide-virtual-folder-v1";
const VIRTUAL_LEXIDE_PREFIX = "lexide-virtual-meta-v1::";

export type LexideWorkspaceMeta = {
    version: 1;
    updatedAt: string;
    openTabs: string[];
    activeFilePath: string | null;
    lastDebugScenario: string;
    commits: unknown[];
};

export function supportsDirectoryPicker(): boolean {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickLocalDirectory(): Promise<DirectoryHandleLike | null> {
    if (!supportsDirectoryPicker()) {
        return null;
    }

    const picker = (window as unknown as {
        showDirectoryPicker: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
    }).showDirectoryPicker;

    const handle = await picker({ mode: "readwrite" });
    await persistDirectoryHandle(handle);

    return handle;
}

export async function loadSavedDirectoryHandle(): Promise<DirectoryHandleLike | null> {
    if (typeof indexedDB === "undefined") {
        return null;
    }

    return new Promise((resolve) => {
        const req = indexedDB.open(IDB_NAME, 1);

        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(IDB_STORE)) {
                req.result.createObjectStore(IDB_STORE);
            }
        };

        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(IDB_STORE, "readonly");
            const getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
            getReq.onsuccess = () => resolve((getReq.result as DirectoryHandleLike | undefined) ?? null);
            getReq.onerror = () => resolve(null);
        };

        req.onerror = () => resolve(null);
    });
}

async function persistDirectoryHandle(handle: DirectoryHandleLike): Promise<void> {
    if (typeof indexedDB === "undefined") {
        return;
    }

    return new Promise((resolve) => {
        const req = indexedDB.open(IDB_NAME, 1);

        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(IDB_STORE)) {
                req.result.createObjectStore(IDB_STORE);
            }
        };

        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(IDB_STORE, "readwrite");
            tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        };

        req.onerror = () => resolve();
    });
}

export async function ensureDirectoryPermission(handle: DirectoryHandleLike): Promise<boolean> {
    if (!handle.queryPermission || !handle.requestPermission) {
        return true;
    }

    const current = await handle.queryPermission({ mode: "readwrite" });

    if (current === "granted") {
        return true;
    }

    const requested = await handle.requestPermission({ mode: "readwrite" });

    return requested === "granted";
}

const NON_HEADER_START = /^(?:Chương\s+|Điều\s+\d+|Căn\s+cứ\s+|Theo\s+đề\s+nghị\s+|\d+\.\s+|[a-zđ]\)\s+)/iu;

/**
 * Extracts the mandatory law title header from line 1 of a document.
 * Returns null if line 1 is empty or starts directly with a structural clause/article.
 */
export function extractHeaderTitle(content: string): string | null {
    const firstLine = content.replace(/\r\n/g, "\n").split("\n")[0]?.trim() ?? "";
    const cleaned = firstLine.replace(/^#+\s*/, "").trim();

    if (!cleaned || NON_HEADER_START.test(cleaned)) {
        return null;
    }

    return cleaned.slice(0, 200);
}

/**
 * Updates or prepends the mandatory line-1 law title header in document content.
 */
export function setHeaderTitle(content: string, nextTitle: string): string {
    const trimmed = nextTitle.trim();

    if (!trimmed) {
        return content;
    }

    const normalized = content.replace(/\r\n/g, "\n");

    if (extractHeaderTitle(normalized) !== null) {
        const lines = normalized.split("\n");
        lines[0] = trimmed;

        return lines.join("\n");
    }

    return normalized.trim().length === 0 ? trimmed : `${trimmed}\n\n${normalized}`;
}

export function normalizeRenamePath(oldPath: string, rawNewName: string): string | null {
    const cleaned = rawNewName.trim().replace(/\\/g, "/");

    if (!cleaned || cleaned.includes("..") || /[\\:*?"<>|]/.test(cleaned)) {
        return null;
    }

    const slashIdx = oldPath.lastIndexOf("/");
    const parentDir = slashIdx >= 0 ? oldPath.slice(0, slashIdx + 1) : "";
    const oldExtMatch = /(\.[^./]+)$/.exec(oldPath);
    const fallbackExt = oldExtMatch ? oldExtMatch[1] : ".txt";

    const targetBase = cleaned.includes("/") ? cleaned : `${parentDir}${cleaned}`;
    const hasValidExt = /\.(?:txt|md|luat|json)$/i.test(targetBase);

    return hasValidExt ? targetBase : `${targetBase}${fallbackExt}`;
}

export async function renameFileInDirectory(
    root: DirectoryHandleLike,
    oldPath: string,
    newPath: string,
    content: string,
): Promise<void> {
    if (oldPath === newPath) {
        return;
    }

    await writeFileToDirectory(root, newPath, content);
    await deleteFileFromDirectory(root, oldPath);
}

export function inferLocalFileMeta(
    relativePath: string,
    content: string,
): Pick<LocalWorkspaceFile, "title" | "documentNumber" | "documentType" | "isLibrary"> {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const isLibrary = normalizedPath.toLowerCase().startsWith("library/") || normalizedPath.toLowerCase().includes("/library/");
    const basename = normalizedPath.split("/").pop() ?? normalizedPath;
    const cleanBase = basename.replace(/\.[^.]+$/, "");
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10);
    const header = lines.join("\n");

    const numMatch = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u.exec(header)
        ?? /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u.exec(cleanBase.replace(/-/g, "/"));
    const documentNumber = numMatch?.[1] ?? null;

    const headerTitle = extractHeaderTitle(content);
    const title = headerTitle ?? cleanBase;

    const hint = `${title} ${documentNumber ?? ""}`;
    const documentType = /Bộ luật/iu.test(hint)
        ? "Bộ luật"
        : /Luật|QH\d*/iu.test(hint)
          ? "Luật"
          : /Nghị định|NĐ-CP/iu.test(hint)
            ? "Nghị định"
            : /Thông tư/iu.test(hint)
              ? "Thông tư"
              : "Văn bản";

    return { title, documentNumber, documentType, isLibrary };
}

export async function readAllFilesFromDirectory(
    root: DirectoryHandleLike,
    prefix = "",
    depth = 0,
): Promise<LocalWorkspaceFile[]> {
    if (depth > 4) {
        return [];
    }

    const files: LocalWorkspaceFile[] = [];

    for await (const [name, entry] of root.entries()) {
        if (name.startsWith(".") || IGNORED_DIRS.has(name)) {
            continue;
        }

        const relPath = prefix ? `${prefix}/${name}` : name;

        if (entry.kind === "directory") {
            const nested = await readAllFilesFromDirectory(entry, relPath, depth + 1);
            files.push(...nested);
            continue;
        }

        const dotIdx = name.lastIndexOf(".");
        const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : "";

        if (!SUPPORTED_EXTENSIONS.has(ext) || name.toLowerCase() === "manifest.json") {
            continue;
        }

        const file = await entry.getFile();

        if (file.size > 500_000) {
            continue;
        }

        const content = await file.text();
        const meta = inferLocalFileMeta(relPath, content);

        files.push({
            path: relPath,
            name,
            title: meta.title,
            documentNumber: meta.documentNumber,
            documentType: meta.documentType,
            content,
            isLibrary: meta.isLibrary,
            updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
        });
    }

    files.sort((a, b) => a.path.localeCompare(b.path, "vi"));

    return files;
}

export async function writeFileToDirectory(
    root: DirectoryHandleLike,
    relativePath: string,
    content: string,
): Promise<void> {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const filename = parts.pop();

    if (!filename) {
        return;
    }

    let dir = root;

    for (const folder of parts) {
        dir = await dir.getDirectoryHandle(folder, { create: true });
    }

    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

export async function readFileFromDirectory(
    root: DirectoryHandleLike,
    relativePath: string,
): Promise<string | null> {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const filename = parts.pop();

    if (!filename) {
        return null;
    }

    try {
        let dir = root;

        for (const folder of parts) {
            dir = await dir.getDirectoryHandle(folder, { create: false });
        }

        const fileHandle = await dir.getFileHandle(filename, { create: false });
        const file = await fileHandle.getFile();

        return await file.text();
    } catch {
        return null;
    }
}

export async function readLexideJsonFromDirectory<T>(
    root: DirectoryHandleLike,
    filename: string,
): Promise<T | null> {
    const raw = await readFileFromDirectory(root, `${LEXIDE_META_DIR}/${filename}`);

    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export async function writeLexideJsonToDirectory(
    root: DirectoryHandleLike,
    filename: string,
    data: unknown,
): Promise<void> {
    await writeFileToDirectory(root, `${LEXIDE_META_DIR}/${filename}`, JSON.stringify(data, null, 2));
}

export function loadVirtualLexideJson<T>(filename: string): T | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const raw = localStorage.getItem(`${VIRTUAL_LEXIDE_PREFIX}${filename}`);

        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

export function saveVirtualLexideJson(filename: string, data: unknown): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        localStorage.setItem(`${VIRTUAL_LEXIDE_PREFIX}${filename}`, JSON.stringify(data));
    } catch {
        // Ignore storage quota errors.
    }
}

export async function deleteFileFromDirectory(root: DirectoryHandleLike, relativePath: string): Promise<void> {
    const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
    const filename = parts.pop();

    if (!filename) {
        return;
    }

    let dir = root;

    for (const folder of parts) {
        dir = await dir.getDirectoryHandle(folder, { create: false });
    }

    await dir.removeEntry(filename);
}

export async function readFilesFromFileList(fileList: FileList): Promise<{ folderName: string; files: LocalWorkspaceFile[] }> {
    const files: LocalWorkspaceFile[] = [];
    let folderName = "Thư mục cục bộ";

    for (const file of Array.from(fileList)) {
        const relRaw = file.webkitRelativePath || file.name;
        const segments = relRaw.replace(/\\/g, "/").split("/");

        if (segments.length > 1) {
            folderName = segments[0];
        }

        const relPath = segments.length > 1 ? segments.slice(1).join("/") : segments[0];

        if (relPath.startsWith(".") || relPath.includes("/.") || file.size > 500_000) {
            continue;
        }

        const dotIdx = file.name.lastIndexOf(".");
        const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : "";

        if (!SUPPORTED_EXTENSIONS.has(ext) || file.name.toLowerCase() === "manifest.json") {
            continue;
        }

        const content = await file.text();
        const meta = inferLocalFileMeta(relPath, content);

        files.push({
            path: relPath,
            name: file.name,
            title: meta.title,
            documentNumber: meta.documentNumber,
            documentType: meta.documentType,
            content,
            isLibrary: meta.isLibrary,
            updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
        });
    }

    files.sort((a, b) => a.path.localeCompare(b.path, "vi"));

    return { folderName, files };
}

export function loadVirtualWorkspaceFiles(): LocalWorkspaceFile[] {
    if (typeof window === "undefined") {
        return [];
    }

    try {
        const raw = localStorage.getItem(VIRTUAL_STORAGE_KEY);

        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw) as unknown;

        return Array.isArray(parsed) ? (parsed as LocalWorkspaceFile[]) : [];
    } catch {
        return [];
    }
}

export function saveVirtualWorkspaceFiles(files: readonly LocalWorkspaceFile[]): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        localStorage.setItem(VIRTUAL_STORAGE_KEY, JSON.stringify(files));
    } catch {
        // Ignore storage quota errors.
    }
}

export function slugifyFilename(value: string, ext = ".txt"): string {
    const ascii = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 60);

    return `${ascii || "du-thao"}${ext}`;
}
