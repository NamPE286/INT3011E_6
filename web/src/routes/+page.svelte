<script lang="ts">
    import type {
        AnalysisResult,
        DebugSimulationResult,
        LegalDiagnostic,
        QuickFix,
        WorkspaceContext,
    } from "$lib/api/ide";
    import ContextMenu, { type ContextMenuItem } from "$lib/components/ide/ContextMenu.svelte";
    import DiffViewer from "$lib/components/ide/DiffViewer.svelte";
    import EditorTabsBar, { type OpenTabView } from "$lib/components/ide/EditorTabsBar.svelte";
    import ExportPreviewModal from "$lib/components/ide/ExportPreviewModal.svelte";
    import IdeSidebar from "$lib/components/ide/IdeSidebar.svelte";
    import IdeStatusBar, { type SessionTokenUsage } from "$lib/components/ide/IdeStatusBar.svelte";
    import IdeTopBar from "$lib/components/ide/IdeTopBar.svelte";
    import InspectorPanel from "$lib/components/ide/InspectorPanel.svelte";
    import LawEditor from "$lib/components/ide/LawEditor.svelte";
    import OnboardingModal from "$lib/components/ide/OnboardingModal.svelte";
    import ProblemsPanel from "$lib/components/ide/ProblemsPanel.svelte";
    import type { DraftCommit } from "$lib/components/ide/SourceControlPanel.svelte";
    import { ResizableHandle, ResizablePane, ResizablePaneGroup } from "$lib/components/ui/resizable";
    import { analyzeLocalDraft } from "$lib/engine/analyzer";
    import { runLocalDebugSimulation } from "$lib/engine/debug";
    import { buildExportFilename, buildVietnameseLegalDocx, buildVietnameseLegalHtml } from "$lib/engine/export";
    import { isGeminiInvalidApiKeyError } from "$lib/engine/gemini-client";
    import { generateAiFixForDiagnostic } from "$lib/engine/llm-fix";
    import { IncrementalLlmCache } from "$lib/engine/llm-incremental";
    import { buildLocalWorkspaceContext, type LocalWorkspaceFile } from "$lib/engine/local-workspace";
    import {
        buildSampleWorkspaceFiles,
        SAMPLE_OPEN_TABS,
        SAMPLE_PRIMARY_DRAFT_PATH,
    } from "$lib/engine/sample-workspace";
    import { buildWorkspaceBehaviorHistory, extractLineBehaviorIndicators } from "$lib/engine/workspace-behaviors";
    import { buildWorkspaceRelationGraph } from "$lib/engine/workspace-relations";
    import { buildSampleLibraryZip, extractLawsFromZipArchive } from "$lib/engine/zip-library";
    import { activeProvisionAtLine, applyQuickFix, cursorPosition } from "$lib/ide-editor";
    import { computeLineDiff } from "$lib/ide-scm";
    import { ideUi } from "$lib/ide-ui.svelte";
    import {
        deleteFileFromDirectory,
        ensureDirectoryPermission,
        extractHeaderTitle,
        inferLocalFileMeta,
        loadSavedDirectoryHandle,
        loadVirtualLexideJson,
        loadVirtualWorkspaceFiles,
        normalizeRenamePath,
        pickLocalDirectory,
        readAllFilesFromDirectory,
        readFilesFromFileList,
        readLexideJsonFromDirectory,
        renameFileInDirectory,
        saveVirtualLexideJson,
        saveVirtualWorkspaceFiles,
        setHeaderTitle,
        slugifyFilename,
        supportsDirectoryPicker,
        writeFileToDirectory,
        writeLexideJsonToDirectory,
        type DirectoryHandleLike,
        type LexideWorkspaceMeta,
    } from "$lib/local-fs";
    import { LOCAL_MODEL_OPTIONS, localSettings } from "$lib/local-settings.svelte";
    import { FilePlus2, FolderOpen, Sparkles } from "@lucide/svelte";
    import { onMount } from "svelte";

    type TabBuffer = {
        content: string;
        baseContent: string;
        isDirty: boolean;
        cursorOffset: number;
    };

    let folderMode = $state<"disk" | "virtual">("virtual");
    let dirHandle = $state<DirectoryHandleLike | null>(null);
    let folderName = $state<string | null>(null);
    let pendingRestoreHandle = $state<DirectoryHandleLike | null>(null);
    let fallbackFolderInput = $state<HTMLInputElement | null>(null);

    let workspaceFiles = $state<LocalWorkspaceFile[]>([]);
    let openTabs = $state<string[]>([]);
    let tabBuffers = $state<Record<string, TabBuffer>>({});
    let activeFilePath = $state<string>("");
    let title = $state<string>("");
    let documentNumber = $state<string>("");
    let content = $state<string>("");
    let baseContent = $state<string>("");

    let renamingPath = $state<string | null>(null);
    let contextMenu = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

    let analysis = $state<AnalysisResult | null>(null);
    let selectedDiagnosticId = $state<string | null>(null);
    let bannerError = $state<string | null>(null);
    let tokenInvalid = $state(false);

    function handleInvalidApiKey(): void {
        tokenInvalid = true;
        localSettings.setApiKey("");
        bannerError = "Gemini API Key không hợp lệ hoặc đã hết hạn. Key hiện tại đã bị xóa — vui lòng nhập API Key mới để tiếp tục sử dụng.";
        ideUi.openSettings();
    }

    let commits = $state<DraftCommit[]>([]);
    let debugResult = $state<DebugSimulationResult | null>(null);
    let lastDebugScenario = $state("Anh A lái xe tự hành chạy quá tốc độ 12 km/h trên đường bộ.");
    let lastDebugUseAi = $state(false);
    let ambiguityOverrides = $state<Record<string, boolean>>({});
    let debugging = $state(false);
    let importingLibrary = $state(false);
    let libraryNotice = $state<string | null>(null);
    let activeDiffMode = $state<"working" | DraftCommit | null>(null);
    let exporting = $state(false);
    let previewHtml = $state<string | null>(null);

    let isDirty = $state(false);
    let analyzing = $state(false);
    let aiAuditing = $state(false);
    let aiPhaseLabel = $state<string | null>(null);
    let fixingDiagnosticId = $state<string | null>(null);
    let sessionTokenUsage = $state<SessionTokenUsage>({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        lastRunTokens: 0,
        savedPercent: null,
    });
    let saving = $state(false);
    let cursorOffset = $state(0);
    let showInspector = $state(true);
    let editorRef = $state<LawEditor | null>(null);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let aiDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let aiAbortController: AbortController | null = null;
    const incrementalLlmCache = new IncrementalLlmCache();

    const cursor = $derived(cursorPosition(content, cursorOffset));
    const activeNode = $derived(analysis ? activeProvisionAtLine(analysis.outline, cursor.line) : null);
    const workspaceContext = $derived<WorkspaceContext>(buildLocalWorkspaceContext(workspaceFiles, activeFilePath));
    const relationGraph = $derived(buildWorkspaceRelationGraph(workspaceFiles, activeFilePath, content));
    const behaviorSummary = $derived(buildWorkspaceBehaviorHistory(workspaceFiles, relationGraph, new Map(), activeFilePath, content));
    const activeLineBehaviors = $derived(activeFilePath ? extractLineBehaviorIndicators(behaviorSummary, activeFilePath) : []);

    $effect(() => {
        ideUi.relationViolationCount = relationGraph.summary.violationCount;
        ideUi.behaviorCount = behaviorSummary.totalBehaviors;
    });

    const openTabViews = $derived<OpenTabView[]>(
        openTabs.map((path) => {
            const file = workspaceFiles.find((item) => item.path === path);

            if (path === activeFilePath) {
                return {
                    path,
                    title: extractHeaderTitle(content) ?? title,
                    name: path.split("/").pop() ?? path,
                    isLibrary: file?.isLibrary ?? false,
                    isDirty,
                };
            }

            const buf = tabBuffers[path];
            const effectiveContent = buf?.content ?? file?.content ?? "";
            const inferredTitle = extractHeaderTitle(effectiveContent) ?? file?.title ?? path.split("/").pop() ?? path;

            return {
                path,
                title: inferredTitle,
                name: path.split("/").pop() ?? path,
                isLibrary: file?.isLibrary ?? false,
                isDirty: buf?.isDirty ?? false,
            };
        }),
    );

    const diffTabInfo = $derived.by(() => {
        if (activeDiffMode === "working") {
            return { id: "working-tree", label: title };
        }

        if (activeDiffMode) {
            return { id: activeDiffMode.id, label: activeDiffMode.message };
        }

        return null;
    });

    $effect(() => {
        const diff = computeLineDiff(baseContent, content);
        ideUi.scmBadgeCount = diff.added + diff.removed;
    });

    async function hydrateFolderLexideData(
        handle: DirectoryHandleLike | null,
        files: readonly LocalWorkspaceFile[],
    ): Promise<{ openTabs: string[]; activeFilePath: string | null }> {
        incrementalLlmCache.clear();

        try {
            const rawCache = handle
                ? await readLexideJsonFromDirectory<unknown>(handle, "cache.json")
                : loadVirtualLexideJson<unknown>("cache.json");

            if (rawCache) {
                incrementalLlmCache.loadFromJSON(rawCache);
            }
        } catch {
            // Ignore malformed .lexide/cache.json
        }

        try {
            const meta = handle
                ? await readLexideJsonFromDirectory<LexideWorkspaceMeta>(handle, "workspace.json")
                : loadVirtualLexideJson<LexideWorkspaceMeta>("workspace.json");

            if (meta && meta.version === 1) {
                commits = Array.isArray(meta.commits) ? (meta.commits as DraftCommit[]) : [];

                if (typeof meta.lastDebugScenario === "string" && meta.lastDebugScenario.trim()) {
                    lastDebugScenario = meta.lastDebugScenario;
                }

                const existingPaths = new Set(files.map((f) => f.path));
                const validTabs = Array.isArray(meta.openTabs)
                    ? meta.openTabs.filter((p): p is string => typeof p === "string" && existingPaths.has(p))
                    : [];
                const validActive = typeof meta.activeFilePath === "string" && existingPaths.has(meta.activeFilePath)
                    ? meta.activeFilePath
                    : null;

                return { openTabs: validTabs, activeFilePath: validActive };
            }
        } catch {
            // Ignore malformed .lexide/workspace.json
        }

        commits = [];

        return { openTabs: [], activeFilePath: null };
    }

    async function persistLexideCache(): Promise<void> {
        const payload = incrementalLlmCache.toJSON();

        try {
            if (folderMode === "disk" && dirHandle) {
                await writeLexideJsonToDirectory(dirHandle, "cache.json", payload);
            } else {
                saveVirtualLexideJson("cache.json", payload);
            }
        } catch {
            // Ignore write errors on read-only folders
        }
    }

    async function persistLexideWorkspaceMeta(): Promise<void> {
        const payload: LexideWorkspaceMeta = {
            version: 1,
            updatedAt: new Date().toISOString(),
            openTabs: [...openTabs],
            activeFilePath: activeFilePath || null,
            lastDebugScenario,
            commits: commits.slice(0, 40),
        };

        try {
            if (folderMode === "disk" && dirHandle) {
                await writeLexideJsonToDirectory(dirHandle, "workspace.json", payload);
            } else {
                saveVirtualLexideJson("workspace.json", payload);
            }
        } catch {
            // Ignore write errors on read-only folders
        }
    }

    onMount(async () => {
        const virtualFiles = loadVirtualWorkspaceFiles();

        if (virtualFiles.length > 0) {
            workspaceFiles = virtualFiles;
            const restored = await hydrateFolderLexideData(null, virtualFiles);
            const target = (restored.activeFilePath ? virtualFiles.find((f) => f.path === restored.activeFilePath) : null)
                ?? virtualFiles.find((item) => !item.isLibrary)
                ?? virtualFiles[0];
            openTabs = restored.openTabs.length > 0 ? restored.openTabs : [target.path];
            openWorkspaceFile(target);
        }

        const savedHandle = await loadSavedDirectoryHandle();

        if (savedHandle) {
            pendingRestoreHandle = savedHandle;
        }
    });

    function saveCurrentTabBuffer(): void {
        if (!activeFilePath || !openTabs.includes(activeFilePath)) {
            return;
        }

        tabBuffers = {
            ...tabBuffers,
            [activeFilePath]: {
                content,
                baseContent,
                isDirty,
                cursorOffset,
            },
        };
    }

    function openWorkspaceFile(file: LocalWorkspaceFile): void {
        if (activeFilePath && activeFilePath !== file.path) {
            saveCurrentTabBuffer();
        }

        if (!openTabs.includes(file.path)) {
            openTabs = [...openTabs, file.path];
        }

        const buf = tabBuffers[file.path];
        const nextContent = buf?.content ?? file.content;

        activeFilePath = file.path;
        content = nextContent;
        baseContent = buf?.baseContent ?? file.content;
        isDirty = buf?.isDirty ?? false;
        cursorOffset = buf?.cursorOffset ?? 0;
        title = extractHeaderTitle(nextContent) ?? file.title;
        documentNumber = file.documentNumber ?? "";
        debugResult = null;
        ambiguityOverrides = {};
        activeDiffMode = null;
        void runAnalysis(false);
    }

    function switchToTab(path: string): void {
        if (path === activeFilePath && activeDiffMode === null) {
            return;
        }

        if (path === activeFilePath) {
            activeDiffMode = null;

            return;
        }

        const file = workspaceFiles.find((item) => item.path === path);
        const buf = tabBuffers[path];

        if (!file && !buf) {
            return;
        }

        saveCurrentTabBuffer();
        const nextContent = buf?.content ?? file?.content ?? "";
        const meta = inferLocalFileMeta(path, nextContent);

        activeFilePath = path;
        content = nextContent;
        baseContent = buf?.baseContent ?? file?.content ?? nextContent;
        isDirty = buf?.isDirty ?? false;
        cursorOffset = buf?.cursorOffset ?? 0;
        title = extractHeaderTitle(nextContent) ?? file?.title ?? meta.title;
        documentNumber = file?.documentNumber ?? meta.documentNumber ?? "";
        debugResult = null;
        ambiguityOverrides = {};
        activeDiffMode = null;
        void runAnalysis(false);
    }

    function closeTab(path: string): void {
        const idx = openTabs.indexOf(path);

        if (idx === -1) {
            return;
        }

        const nextTabs = openTabs.filter((item) => item !== path);
        const nextBuffers = { ...tabBuffers };
        delete nextBuffers[path];

        openTabs = nextTabs;
        tabBuffers = nextBuffers;

        if (activeFilePath === path) {
            activeDiffMode = null;

            if (nextTabs.length > 0) {
                const fallbackPath = nextTabs[Math.min(idx, nextTabs.length - 1)];
                const file = workspaceFiles.find((item) => item.path === fallbackPath);
                const buf = nextBuffers[fallbackPath];
                const nextContent = buf?.content ?? file?.content ?? "";

                activeFilePath = fallbackPath;
                content = nextContent;
                baseContent = buf?.baseContent ?? file?.content ?? nextContent;
                isDirty = buf?.isDirty ?? false;
                cursorOffset = buf?.cursorOffset ?? 0;
                title = extractHeaderTitle(nextContent) ?? file?.title ?? fallbackPath;
                documentNumber = file?.documentNumber ?? "";
                void runAnalysis(false);
            } else {
                activeFilePath = "";
                title = "";
                documentNumber = "";
                content = "";
                baseContent = "";
                isDirty = false;
                analysis = null;
                selectedDiagnosticId = null;
            }
        }
    }

    function closeOtherTabs(keepPath: string): void {
        const keepBuf = keepPath === activeFilePath
            ? { content, baseContent, isDirty, cursorOffset }
            : tabBuffers[keepPath];
        openTabs = [keepPath];
        tabBuffers = keepBuf ? { [keepPath]: keepBuf } : {};

        if (activeFilePath !== keepPath) {
            switchToTab(keepPath);
        }
    }

    function closeAllTabs(): void {
        openTabs = [];
        tabBuffers = {};
        activeFilePath = "";
        activeDiffMode = null;
        title = "";
        documentNumber = "";
        content = "";
        baseContent = "";
        isDirty = false;
        analysis = null;
        selectedDiagnosticId = null;
    }

    async function persistWorkspaceFile(file: LocalWorkspaceFile): Promise<void> {
        if (folderMode === "disk" && dirHandle) {
            await writeFileToDirectory(dirHandle, file.path, file.content);
        }

        const idx = workspaceFiles.findIndex((item) => item.path === file.path);

        if (idx >= 0) {
            workspaceFiles = workspaceFiles.map((item, i) => (i === idx ? file : item));
        } else {
            workspaceFiles = [...workspaceFiles, file];
        }

        if (folderMode === "virtual") {
            saveVirtualWorkspaceFiles(workspaceFiles);
        }
    }

    async function removeWorkspaceFile(path: string): Promise<void> {
        if (folderMode === "disk" && dirHandle) {
            await deleteFileFromDirectory(dirHandle, path);
        }

        workspaceFiles = workspaceFiles.filter((item) => item.path !== path);

        if (folderMode === "virtual") {
            saveVirtualWorkspaceFiles(workspaceFiles);
        }
    }

    async function handleCommitRename(oldPath: string, rawNewName: string): Promise<void> {
        renamingPath = null;
        bannerError = null;

        const newPath = normalizeRenamePath(oldPath, rawNewName);

        if (!newPath) {
            bannerError = "Tên tệp không hợp lệ.";

            return;
        }

        if (newPath === oldPath) {
            return;
        }

        if (workspaceFiles.some((item) => item.path === newPath)) {
            bannerError = `Đã tồn tại tệp "${newPath}" trong thư mục.`;

            return;
        }

        const existing = workspaceFiles.find((item) => item.path === oldPath);

        if (!existing) {
            return;
        }

        const effectiveContent = oldPath === activeFilePath
            ? content
            : tabBuffers[oldPath]?.content ?? existing.content;

        try {
            if (folderMode === "disk" && dirHandle) {
                await renameFileInDirectory(dirHandle, oldPath, newPath, effectiveContent);
            }

            const meta = inferLocalFileMeta(newPath, effectiveContent);
            const updatedFile: LocalWorkspaceFile = {
                ...existing,
                path: newPath,
                name: newPath.split("/").pop() ?? newPath,
                title: extractHeaderTitle(effectiveContent) ?? meta.title,
                isLibrary: meta.isLibrary,
                updatedAt: new Date().toISOString(),
            };

            workspaceFiles = workspaceFiles.map((item) => (item.path === oldPath ? updatedFile : item));

            if (folderMode === "virtual") {
                saveVirtualWorkspaceFiles(workspaceFiles);
            }

            openTabs = openTabs.map((tabPath) => (tabPath === oldPath ? newPath : tabPath));

            if (tabBuffers[oldPath]) {
                const nextBuffers = { ...tabBuffers };
                nextBuffers[newPath] = nextBuffers[oldPath];
                delete nextBuffers[oldPath];
                tabBuffers = nextBuffers;
            }

            if (activeFilePath === oldPath) {
                activeFilePath = newPath;
                title = updatedFile.title;
            }

            await runAnalysis(false);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể đổi tên tệp";
        }
    }

    async function handleRenameFromHeader(path: string): Promise<void> {
        const file = workspaceFiles.find((item) => item.path === path);
        const fileContent = path === activeFilePath ? content : tabBuffers[path]?.content ?? file?.content ?? "";
        const headerTitle = extractHeaderTitle(fileContent);

        if (!headerTitle) {
            bannerError = "Tệp chưa có dòng tiêu đề tên luật ở dòng 1 để suy luận tên tệp.";

            return;
        }

        const extMatch = /(\.[^./]+)$/.exec(path);
        const slugName = slugifyFilename(headerTitle, extMatch?.[1] ?? ".txt");
        await handleCommitRename(path, slugName);
    }

    async function handleDuplicateFile(path: string): Promise<void> {
        const file = workspaceFiles.find((item) => item.path === path);

        if (!file) {
            return;
        }

        const extMatch = /(\.[^./]+)$/.exec(path);
        const ext = extMatch?.[1] ?? ".txt";
        const baseNoExt = path.slice(0, path.length - ext.length);
        let candidate = `${baseNoExt}-copy${ext}`;
        let idx = 2;

        while (workspaceFiles.some((item) => item.path === candidate)) {
            candidate = `${baseNoExt}-copy-${idx}${ext}`;
            idx += 1;
        }

        const copyContent = path === activeFilePath ? content : tabBuffers[path]?.content ?? file.content;
        const copyFile: LocalWorkspaceFile = {
            ...file,
            path: candidate,
            name: candidate.split("/").pop() ?? candidate,
            content: copyContent,
            updatedAt: new Date().toISOString(),
        };

        await persistWorkspaceFile(copyFile);
        openWorkspaceFile(copyFile);
    }

    function openFileContextMenu(event: MouseEvent, path: string): void {
        const file = workspaceFiles.find((item) => item.path === path);
        const fileContent = path === activeFilePath ? content : tabBuffers[path]?.content ?? file?.content ?? "";
        const hasHeader = extractHeaderTitle(fileContent) !== null;

        contextMenu = {
            x: event.clientX,
            y: event.clientY,
            items: [
                {
                    id: "open",
                    label: "Mở trong Tab",
                    onSelect: () => {
                        if (file) {
                            openWorkspaceFile(file);
                        }
                    },
                },
                {
                    id: "rename",
                    label: "Đổi tên tệp",
                    shortcut: "F2",
                    onSelect: () => {
                        ideUi.openView("explorer");
                        renamingPath = path;
                    },
                },
                {
                    id: "rename-header",
                    label: "Đổi tên tệp theo dòng tiêu đề",
                    disabled: !hasHeader,
                    onSelect: () => void handleRenameFromHeader(path),
                },
                {
                    id: "duplicate",
                    label: "Nhân bản tệp",
                    onSelect: () => void handleDuplicateFile(path),
                },
                { id: "sep-1", separator: true },
                {
                    id: "copy-path",
                    label: "Sao chép đường dẫn",
                    onSelect: () => void navigator.clipboard?.writeText(path),
                },
                {
                    id: "delete",
                    label: "Xóa tệp khỏi thư mục",
                    danger: true,
                    onSelect: () => void handleDeleteFile(path),
                },
            ],
        };
    }

    function openExplorerContextMenu(event: MouseEvent): void {
        contextMenu = {
            x: event.clientX,
            y: event.clientY,
            items: [
                {
                    id: "new-file",
                    label: "Tạo tệp dự thảo mới",
                    onSelect: () => void handleCreateNewFile(),
                },
                {
                    id: "seed-sample",
                    label: "Nạp bộ dự thảo mẫu (10 tệp)",
                    onSelect: () => void handleSeedSampleFile(),
                },
                { id: "sep-1", separator: true },
                {
                    id: "open-folder",
                    label: "Chọn thư mục trên máy...",
                    onSelect: () => void handlePickFolder(),
                },
            ],
        };
    }

    function openTabContextMenu(event: MouseEvent, path: string): void {
        contextMenu = {
            x: event.clientX,
            y: event.clientY,
            items: [
                {
                    id: "tab-rename",
                    label: "Đổi tên tệp...",
                    shortcut: "F2",
                    onSelect: () => {
                        ideUi.openView("explorer");
                        renamingPath = path;
                    },
                },
                {
                    id: "tab-rename-header",
                    label: "Đổi tên theo dòng tiêu đề",
                    onSelect: () => void handleRenameFromHeader(path),
                },
                { id: "sep-1", separator: true },
                {
                    id: "tab-close",
                    label: "Đóng tab",
                    onSelect: () => closeTab(path),
                },
                {
                    id: "tab-close-others",
                    label: "Đóng các tab khác",
                    disabled: openTabs.length <= 1,
                    onSelect: () => closeOtherTabs(path),
                },
                {
                    id: "tab-close-all",
                    label: "Đóng tất cả tab",
                    onSelect: () => closeAllTabs(),
                },
            ],
        };
    }

    async function handlePickFolder(): Promise<void> {
        bannerError = null;

        if (!supportsDirectoryPicker()) {
            fallbackFolderInput?.click();

            return;
        }

        try {
            const handle = await pickLocalDirectory();

            if (!handle) {
                return;
            }

            const files = await readAllFilesFromDirectory(handle);
            dirHandle = handle;
            folderMode = "disk";
            folderName = handle.name;
            pendingRestoreHandle = null;
            workspaceFiles = files;
            tabBuffers = {};
            const restored = await hydrateFolderLexideData(handle, files);

            if (files.length > 0) {
                const firstDraft = (restored.activeFilePath ? files.find((f) => f.path === restored.activeFilePath) : null)
                    ?? files.find((item) => !item.isLibrary)
                    ?? files[0];
                openTabs = restored.openTabs.length > 0 ? restored.openTabs : [firstDraft.path];
                openWorkspaceFile(firstDraft);
            } else {
                closeAllTabs();
            }
        } catch (cause: unknown) {
            if (cause instanceof DOMException && cause.name === "AbortError") {
                return;
            }

            bannerError = cause instanceof Error ? cause.message : "Không thể mở thư mục trên máy";
        }
    }

    async function handleRestoreSavedFolder(): Promise<void> {
        if (!pendingRestoreHandle) {
            return;
        }

        try {
            const granted = await ensureDirectoryPermission(pendingRestoreHandle);

            if (!granted) {
                return;
            }

            const files = await readAllFilesFromDirectory(pendingRestoreHandle);
            dirHandle = pendingRestoreHandle;
            folderMode = "disk";
            folderName = pendingRestoreHandle.name;
            pendingRestoreHandle = null;
            workspaceFiles = files;
            tabBuffers = {};
            const restored = await hydrateFolderLexideData(pendingRestoreHandle, files);

            if (files.length > 0) {
                const first = (restored.activeFilePath ? files.find((f) => f.path === restored.activeFilePath) : null)
                    ?? files.find((item) => !item.isLibrary)
                    ?? files[0];
                openTabs = restored.openTabs.length > 0 ? restored.openTabs : [first.path];
                openWorkspaceFile(first);
            }
        } catch {
            pendingRestoreHandle = null;
        }
    }

    async function handleFallbackFolderInput(event: Event): Promise<void> {
        const input = event.currentTarget;

        if (!(input instanceof HTMLInputElement) || !input.files || input.files.length === 0) {
            return;
        }

        const loaded = await readFilesFromFileList(input.files);
        folderMode = "virtual";
        dirHandle = null;
        folderName = loaded.folderName;
        workspaceFiles = loaded.files;
        tabBuffers = {};
        saveVirtualWorkspaceFiles(loaded.files);

        if (loaded.files.length > 0) {
            const first = loaded.files.find((item) => !item.isLibrary) ?? loaded.files[0];
            openTabs = [first.path];
            openWorkspaceFile(first);
        } else {
            closeAllTabs();
        }

        input.value = "";
    }

    function scheduleAutoLlmExtract(): void {
        if (!localSettings.hasApiKey || !localSettings.autoLlm || (!activeFilePath && !content.trim())) {
            return;
        }

        if (aiDebounceTimer) {
            clearTimeout(aiDebounceTimer);
        }

        aiDebounceTimer = setTimeout(() => {
            void runAnalysis(true, true);
        }, 900);
    }

    async function runAnalysis(includeAi = false, isAuto = false): Promise<void> {
        if (!activeFilePath && !content.trim()) {
            analysis = null;

            return;
        }

        if (includeAi && !localSettings.hasApiKey) {
            if (!isAuto) {
                ideUi.openSettings();
                bannerError = "Hãy nhập API Token của bạn để chạy bước Extract AI (hoặc dùng Lean 4 0-token).";
            }

            return;
        }

        const controller = includeAi ? new AbortController() : null;

        if (includeAi && controller) {
            aiAbortController?.abort();
            aiAbortController = controller;
        }

        analyzing = true;

        if (includeAi) {
            aiAuditing = true;
            aiPhaseLabel = "Đang khởi chạy AI Analyzer...";
        }

        if (!isAuto) {
            bannerError = null;
        }

        try {
            const next = await analyzeLocalDraft(content, workspaceFiles, {
                currentPath: activeFilePath,
                includeAi,
                useDecisionApi: localSettings.useDecisionApi,
                deepNeuroSymbolic: true,
                apiKey: localSettings.apiKey,
                apiBaseUrl: localSettings.apiBaseUrl,
                model: localSettings.model,
                incrementalCache: incrementalLlmCache,
                signal: controller?.signal,
                onProgress: (_phase, detail) => {
                    if (controller && !controller.signal.aborted) {
                        aiPhaseLabel = detail;
                    }
                },
            });

            if (controller?.signal.aborted) {
                return;
            }

            analysis = next;

            if (includeAi) {
                const breakdown = next.lean?.tokenStats.tokenBreakdown;
                const runTokens = next.lean?.tokenStats.actualAiTokens ?? 0;
                const runInput = breakdown
                    ? breakdown.decisionInputTokens + breakdown.extractInputTokens
                    : 0;
                const runOutput = breakdown ? breakdown.extractOutputTokens : 0;

                sessionTokenUsage = {
                    inputTokens: sessionTokenUsage.inputTokens + runInput,
                    outputTokens: sessionTokenUsage.outputTokens + runOutput,
                    totalTokens: sessionTokenUsage.totalTokens + runTokens,
                    lastRunTokens: runTokens,
                    savedPercent: next.lean?.tokenStats.savedPercent ?? sessionTokenUsage.savedPercent,
                    llmCalls: (sessionTokenUsage.llmCalls ?? 0) + (runTokens > 0 ? 1 : 0),
                };
            } else {
                sessionTokenUsage = {
                    ...sessionTokenUsage,
                    lastRunTokens: 0,
                    savedPercent: next.lean?.tokenStats.savedPercent ?? sessionTokenUsage.savedPercent,
                };
            }

            if (includeAi && next.aiStatus.error) {
                if (isGeminiInvalidApiKeyError(next.aiStatus.error)) {
                    handleInvalidApiKey();
                } else if (!isAuto) {
                    bannerError = next.aiStatus.error;
                }
            } else if (includeAi && next.aiStatus.error === null) {
                tokenInvalid = false;
                void persistLexideCache();
            }

            if (next.diagnostics.length === 0) {
                selectedDiagnosticId = null;
            } else if (!next.diagnostics.some((item) => item.id === selectedDiagnosticId)) {
                selectedDiagnosticId = next.diagnostics[0].id;
            }
        } catch (cause: unknown) {
            if (isGeminiInvalidApiKeyError(cause)) {
                handleInvalidApiKey();
            } else if (!isAuto && !controller?.signal.aborted) {
                bannerError = cause instanceof Error ? cause.message : "Không thể kiểm định dự thảo";
            }
        } finally {
            analyzing = false;

            if (includeAi && aiAbortController === controller) {
                aiAuditing = false;
                aiPhaseLabel = null;
            }
        }
    }

    function handleRefreshEngine(): void {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }

        if (aiDebounceTimer) {
            clearTimeout(aiDebounceTimer);
            aiDebounceTimer = null;
        }

        if (!localSettings.hasApiKey) {
            ideUi.openSettings();

            return;
        }

        aiAbortController?.abort();
        aiAbortController = null;
        incrementalLlmCache.clear();
        void persistLexideCache();
        void runAnalysis(true, false);
    }

    function handleContentChange(nextContent: string): void {
        content = nextContent;
        isDirty = true;

        const headerTitle = extractHeaderTitle(nextContent);

        if (headerTitle) {
            title = headerTitle;
            workspaceFiles = workspaceFiles.map((item) =>
                item.path === activeFilePath ? { ...item, title: headerTitle } : item,
            );
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            void runAnalysis(false);
        }, 250);

        scheduleAutoLlmExtract();
    }

    function handleTitleInput(nextTitle: string): void {
        title = nextTitle;
        const updated = setHeaderTitle(content, nextTitle);

        if (updated !== content) {
            content = updated;
        }

        isDirty = true;
    }

    async function handleSave(commitMessage?: string): Promise<void> {
        if (!activeFilePath && !content.trim()) {
            return;
        }

        saving = true;
        bannerError = null;

        try {
            const diff = computeLineDiff(baseContent, content);
            const nextPath = activeFilePath || slugifyFilename(documentNumber || title);
            const meta = inferLocalFileMeta(nextPath, content);
            const resolvedTitle = extractHeaderTitle(content) ?? (title.trim() || meta.title);
            const fileRecord: LocalWorkspaceFile = {
                path: nextPath,
                name: nextPath.split("/").pop() ?? nextPath,
                title: resolvedTitle,
                documentNumber: documentNumber.trim() || meta.documentNumber,
                documentType: meta.documentType,
                content,
                isLibrary: meta.isLibrary,
                updatedAt: new Date().toISOString(),
            };

            await persistWorkspaceFile(fileRecord);
            activeFilePath = nextPath;
            title = resolvedTitle;

            if (!openTabs.includes(nextPath)) {
                openTabs = [...openTabs, nextPath];
            }

            if (commitMessage) {
                commits = [
                    {
                        id: crypto.randomUUID(),
                        message: commitMessage,
                        timestamp: new Date().toISOString(),
                        content,
                        added: diff.added,
                        removed: diff.removed,
                    },
                    ...commits,
                ];
            }

            baseContent = content;
            isDirty = false;
            saveCurrentTabBuffer();
            await runAnalysis(false);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể lưu tệp vào thư mục";
        } finally {
            saving = false;
        }
    }

    async function handleCreateNewFile(): Promise<void> {
        let idx = workspaceFiles.filter((f) => !f.isLibrary).length + 1;
        let path = `du-thao-${idx}.txt`;

        while (workspaceFiles.some((f) => f.path === path)) {
            idx += 1;
            path = `du-thao-${idx}.txt`;
        }

        const headerTitle = `Dự thảo văn bản quy phạm pháp luật ${idx}`;
        const body = `${headerTitle}\n\nĐiều 1. Phạm vi điều chỉnh\n1. Quy định này áp dụng đối với...\n\nĐiều 2. Hiệu lực thi hành\n1. Văn bản này có hiệu lực từ ngày...`;
        const fileRecord: LocalWorkspaceFile = {
            path,
            name: path,
            title: headerTitle,
            documentNumber: null,
            documentType: "Văn bản",
            content: body,
            isLibrary: false,
            updatedAt: new Date().toISOString(),
        };
        await persistWorkspaceFile(fileRecord);
        openWorkspaceFile(fileRecord);
    }

    async function handleSeedSampleFile(): Promise<void> {
        const sampleFiles = buildSampleWorkspaceFiles();

        for (const fileRecord of sampleFiles) {
            await persistWorkspaceFile(fileRecord);
        }

        const primary = sampleFiles.find((f) => f.path === SAMPLE_PRIMARY_DRAFT_PATH) ?? sampleFiles[0];
        openTabs = [...SAMPLE_OPEN_TABS];
        tabBuffers = {};

        if (primary) {
            openWorkspaceFile(primary);
        }
    }

    async function handleDeleteFile(path: string): Promise<void> {
        await removeWorkspaceFile(path);

        if (openTabs.includes(path)) {
            closeTab(path);
        }

        await runAnalysis(false);
    }

    async function handleForkBaseLaw(libraryPath: string): Promise<void> {
        const baseFile = workspaceFiles.find((item) => item.path === libraryPath);

        if (!baseFile) {
            return;
        }

        const newTitle = `Dự thảo sửa đổi ${baseFile.documentNumber ?? baseFile.title}`;
        const newPath = slugifyFilename(`sua-doi-${baseFile.documentNumber ?? baseFile.title}`, ".txt");
        const newContent = `${newTitle}\n\nCăn cứ ${baseFile.documentType ?? "Văn bản"} số ${baseFile.documentNumber ?? baseFile.title};\n\n${baseFile.content}`;
        const fileRecord: LocalWorkspaceFile = {
            path: newPath,
            name: newPath,
            title: newTitle,
            documentNumber: baseFile.documentNumber ? `${baseFile.documentNumber} (Dự thảo)` : null,
            documentType: baseFile.documentType,
            content: newContent,
            isLibrary: false,
            updatedAt: new Date().toISOString(),
        };

        await persistWorkspaceFile(fileRecord);
        ideUi.openView("explorer");
        openWorkspaceFile(fileRecord);
    }

    async function addLibraryLaws(
        laws: { title: string; documentNumber: string; documentType: string; content: string }[],
    ): Promise<number> {
        let count = 0;

        for (const law of laws) {
            const filename = slugifyFilename(law.documentNumber || law.title, ".txt");
            const path = `library/${filename}`;
            const headerTitle = extractHeaderTitle(law.content);
            const normalizedContent = headerTitle ? law.content : `${law.title}\n\n${law.content}`;
            const fileRecord: LocalWorkspaceFile = {
                path,
                name: filename,
                title: headerTitle ?? law.title,
                documentNumber: law.documentNumber,
                documentType: law.documentType,
                content: normalizedContent,
                isLibrary: true,
                updatedAt: new Date().toISOString(),
            };
            await persistWorkspaceFile(fileRecord);
            count += 1;
        }

        return count;
    }

    async function handleImportLibrary(payload: {
        title: string;
        documentNumber: string;
        documentType: string;
        content: string;
    }): Promise<void> {
        importingLibrary = true;
        bannerError = null;
        libraryNotice = null;

        try {
            await addLibraryLaws([payload]);
            libraryNotice = `Đã lưu "${payload.title}" vào thư mục library/.`;
            await runAnalysis(false);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể import bộ luật vào Library";
        } finally {
            importingLibrary = false;
        }
    }

    async function handleImportLibraryBatch(
        laws: { title: string; documentNumber: string; documentType: string; content: string }[],
    ): Promise<void> {
        importingLibrary = true;
        bannerError = null;
        libraryNotice = null;

        try {
            const count = await addLibraryLaws(laws);
            libraryNotice = `Đã import ${count} bộ luật vào thư mục library/.`;
            await runAnalysis(false);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể import hàng loạt bộ luật";
        } finally {
            importingLibrary = false;
        }
    }

    async function handleImportLibraryZip(file: File): Promise<void> {
        importingLibrary = true;
        bannerError = null;
        libraryNotice = null;

        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const { laws, skipped } = await extractLawsFromZipArchive(bytes);

            if (laws.length === 0) {
                bannerError = "Gói .zip không chứa tệp luật hợp lệ (.txt, .md, .luat, .json).";

                return;
            }

            const count = await addLibraryLaws(laws);
            const skipNote = skipped.length > 0 ? ` (bỏ qua ${skipped.length} tệp)` : "";
            libraryNotice = `Đã giải nén & import ${count} bộ luật từ "${file.name}"${skipNote}.`;
            await runAnalysis(false);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể giải nén gói .zip";
        } finally {
            importingLibrary = false;
        }
    }

    function handleDownloadSampleZip(): void {
        const bytes = buildSampleLibraryZip();
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const blob = new Blob([copy], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "bo-luat-mau-lexide.zip";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function handleInsertBasis(basisLine: string): void {
        if (!activeFilePath || content.includes(basisLine)) {
            return;
        }

        const header = extractHeaderTitle(content);

        if (header) {
            const lines = content.replace(/\r\n/g, "\n").split("\n");
            const rest = lines.slice(1).join("\n").replace(/^\n+/, "");
            handleContentChange(`${lines[0]}\n\n${basisLine}\n\n${rest}`);
            editorRef?.focusLine(3, 0);
        } else {
            handleContentChange(`${basisLine}\n\n${content}`);
            editorRef?.focusLine(1, 0);
        }
    }

    function handleDiscardChanges(): void {
        content = baseContent;
        title = extractHeaderTitle(baseContent) ?? title;
        isDirty = false;
        activeDiffMode = null;
        void runAnalysis(false);
    }

    function handleExportDocx(): void {
        if (!activeFilePath && !content.trim()) {
            bannerError = "Hãy mở hoặc tạo một văn bản trước khi xuất Word.";

            return;
        }

        exporting = true;
        bannerError = null;

        try {
            const bytes = buildVietnameseLegalDocx({
                title,
                documentNumber: documentNumber || null,
                content,
            });
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            const blob = new Blob([copy], {
                type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = buildExportFilename(documentNumber, title, "docx");
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (cause: unknown) {
            bannerError = cause instanceof Error ? cause.message : "Không thể xuất tệp Word (.docx)";
        } finally {
            exporting = false;
        }
    }

    function triggerPrintHtml(html: string): void {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        iframe.srcdoc = html;
        iframe.onload = () => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => iframe.remove(), 1500);
        };
        document.body.appendChild(iframe);
    }

    function handleExportPdf(): void {
        if (!activeFilePath && !content.trim()) {
            bannerError = "Hãy mở hoặc tạo một văn bản trước khi xuất PDF.";

            return;
        }

        const html = buildVietnameseLegalHtml({
            title,
            documentNumber: documentNumber || null,
            content,
        });
        triggerPrintHtml(html);
    }

    function handlePreviewExport(): void {
        if (!activeFilePath && !content.trim()) {
            bannerError = "Hãy mở hoặc tạo một văn bản trước khi xem trước bản in.";

            return;
        }

        previewHtml = buildVietnameseLegalHtml({
            title,
            documentNumber: documentNumber || null,
            content,
        });
    }

    async function executeDebug(scenarioText: string, useAi: boolean, overrides: Record<string, boolean>): Promise<void> {
        if (!activeFilePath && !content.trim()) {
            bannerError = "Hãy mở hoặc tạo một văn bản trước khi chạy thử.";

            return;
        }

        if (useAi && !localSettings.hasApiKey) {
            ideUi.openSettings();
            bannerError = "Hãy nhập API Token để dùng diễn giải AI trong Run & Debug.";

            return;
        }

        debugging = true;
        bannerError = null;
        lastDebugScenario = scenarioText;
        lastDebugUseAi = useAi;

        try {
            debugResult = await runLocalDebugSimulation({
                content,
                scenario: scenarioText,
                workspaceFiles,
                currentPath: activeFilePath,
                ambiguityOverrides: overrides,
                useAi,
                useDecisionGate: useAi,
                apiKey: localSettings.apiKey,
                apiBaseUrl: localSettings.apiBaseUrl,
                model: localSettings.model,
            });

            if (debugResult.tokenUsage && (debugResult.tokenUsage.totalTokens > 0 || (debugResult.llmCalls ?? 0) > 0)) {
                const runInput = debugResult.tokenUsage.inputTokens + (debugResult.tokenUsage.decisionInputTokens ?? 0);
                const runOutput = debugResult.tokenUsage.outputTokens;
                const runTotal = debugResult.tokenUsage.totalTokens;

                sessionTokenUsage = {
                    inputTokens: sessionTokenUsage.inputTokens + runInput,
                    outputTokens: sessionTokenUsage.outputTokens + runOutput,
                    totalTokens: sessionTokenUsage.totalTokens + runTotal,
                    lastRunTokens: runTotal,
                    savedPercent: sessionTokenUsage.savedPercent,
                    llmCalls: (sessionTokenUsage.llmCalls ?? 0) + (debugResult.llmCalls ?? 0),
                };
            }
        } catch (cause: unknown) {
            if (isGeminiInvalidApiKeyError(cause)) {
                handleInvalidApiKey();
            } else {
                bannerError = cause instanceof Error ? cause.message : "Không thể chạy Tòa án giả lập";
            }
        } finally {
            debugging = false;
        }
    }

    function handleChangeOverride(id: string, value: boolean): void {
        const nextOverrides = { ...ambiguityOverrides, [id]: value };
        ambiguityOverrides = nextOverrides;
        void executeDebug(lastDebugScenario, lastDebugUseAi, nextOverrides);
    }

    function handleJumpToFileLine(path: string, line: number): void {
        const target = workspaceFiles.find((item) => item.path === path);

        if (target && path !== activeFilePath) {
            openWorkspaceFile(target);
        }

        activeDiffMode = null;
        queueMicrotask(() => editorRef?.focusLine(line));
    }

    function handleSelectDiagnostic(diag: LegalDiagnostic): void {
        selectedDiagnosticId = diag.id;
        activeDiffMode = null;
        editorRef?.focusLine(diag.range.startLine, diag.range.startOffset);
    }

    function handleCursorDiagnostic(diag: LegalDiagnostic): void {
        if (selectedDiagnosticId !== diag.id) {
            selectedDiagnosticId = diag.id;
        }
    }

    function handleApplyQuickFix(fix: QuickFix): void {
        const nextContent = applyQuickFix(content, fix);
        handleContentChange(nextContent);
    }

    async function handleAiFixDiagnostic(diag: LegalDiagnostic): Promise<void> {
        if (!localSettings.hasApiKey) {
            ideUi.openSettings();
            bannerError = "Hãy nhập Gemini API Token để sử dụng tính năng Sửa bằng AI.";

            return;
        }

        if (fixingDiagnosticId !== null) {
            return;
        }

        fixingDiagnosticId = diag.id;
        bannerError = null;

        try {
            const result = await generateAiFixForDiagnostic({
                content,
                diagnostic: diag,
                workspaceContext,
                apiKey: localSettings.apiKey,
                apiBaseUrl: localSettings.apiBaseUrl,
                model: localSettings.model,
            });

            sessionTokenUsage = {
                inputTokens: sessionTokenUsage.inputTokens + result.usage.inputTokens,
                outputTokens: sessionTokenUsage.outputTokens + result.usage.outputTokens,
                totalTokens: sessionTokenUsage.totalTokens + result.usage.totalTokens,
                lastRunTokens: result.usage.totalTokens,
                savedPercent: sessionTokenUsage.savedPercent,
                llmCalls: (sessionTokenUsage.llmCalls ?? 0) + 1,
            };

            const nextContent = applyQuickFix(content, result.fix);
            handleContentChange(nextContent);
            await runAnalysis(false);
        } catch (cause: unknown) {
            if (isGeminiInvalidApiKeyError(cause)) {
                handleInvalidApiKey();
            } else {
                bannerError = cause instanceof Error ? cause.message : "Không thể sửa lỗi bằng AI";
            }
        } finally {
            fixingDiagnosticId = null;
        }
    }

    function handleGlobalKeydown(event: KeyboardEvent): void {
        if (event.key === "F5") {
            event.preventDefault();
            ideUi.openView("debug");
            void executeDebug(lastDebugScenario, lastDebugUseAi, ambiguityOverrides);
        } else if (event.key === "F2" && activeFilePath) {
            const activeTag = document.activeElement?.tagName;

            if (activeTag !== "TEXTAREA" && activeTag !== "INPUT") {
                event.preventDefault();
                ideUi.openView("explorer");
                renamingPath = activeFilePath;
            }
        } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
            event.preventDefault();
            ideUi.openView("search");
        }
    }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
    <title>LexIDE — Local-First Legal IDE</title>
</svelte:head>

<input
    bind:this={fallbackFolderInput}
    type="file"
    multiple
    onchange={handleFallbackFolderInput}
    class="hidden"
    {...({ webkitdirectory: true, directory: true } as Record<string, unknown>)}
/>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <IdeTopBar
        {title}
        {documentNumber}
        isTemplate={false}
        {isDirty}
        {analyzing}
        {aiAuditing}
        {debugging}
        {saving}
        {exporting}
        models={[...LOCAL_MODEL_OPTIONS]}
        selectedModel={localSettings.model}
        {tokenInvalid}
        showSidebar={ideUi.sidebarOpen}
        {showInspector}
        onTitleChange={handleTitleInput}
        onDocNumberChange={(value) => {
            documentNumber = value;
            isDirty = true;
        }}
        onRefreshEngine={handleRefreshEngine}
        onOpenSettings={() => ideUi.openSettings()}
        onRunDebug={() => {
            ideUi.openView("debug");
            void executeDebug(lastDebugScenario, lastDebugUseAi, ambiguityOverrides);
        }}
        onSave={() => void handleSave()}
        onNewDraft={() => void handleCreateNewFile()}
        onExportDocx={handleExportDocx}
        onExportPdf={handleExportPdf}
        onPreviewExport={handlePreviewExport}
        onModelChange={(value) => {
            localSettings.setModel(value);

            if ((activeFilePath || content.trim()) && localSettings.hasApiKey) {
                void runAnalysis(true, false);
            }
        }}
        onToggleSidebar={() => (ideUi.sidebarOpen = !ideUi.sidebarOpen)}
        onToggleInspector={() => (showInspector = !showInspector)}
    />

    {#if bannerError}
        <div role="alert" class="flex shrink-0 items-center justify-between gap-2 border-b bg-destructive/15 px-4 py-1 text-xs text-destructive">
            <span class="min-w-0 truncate">{bannerError}</span>
            <div class="flex shrink-0 items-center gap-2">
                {#if tokenInvalid || isGeminiInvalidApiKeyError(bannerError)}
                    <button
                        type="button"
                        onclick={() => ideUi.openSettings()}
                        class="rounded-[2px] border border-destructive/50 bg-destructive/20 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/30"
                    >
                        Đổi API Token
                    </button>
                {/if}
                <button
                    type="button"
                    onclick={() => (bannerError = null)}
                    title="Đóng thông báo"
                    class="rounded-[2px] px-1.5 py-0.5 text-[11px] hover:bg-destructive/20"
                >
                    ✕
                </button>
            </div>
        </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden">
        <ResizablePaneGroup direction="horizontal" class="h-full">
            {#if ideUi.sidebarOpen}
                <ResizablePane defaultSize={22} minSize={15} maxSize={35} class="hidden lg:block">
                    <IdeSidebar
                        {folderName}
                        {folderMode}
                        pendingRestoreFolderName={pendingRestoreHandle?.name ?? null}
                        {workspaceFiles}
                        {workspaceContext}
                        outline={analysis?.outline ?? []}
                        {activeFilePath}
                        activeLine={cursor.line}
                        {title}
                        {documentNumber}
                        {content}
                        {baseContent}
                        {commits}
                        {isDirty}
                        {saving}
                        activeDiffId={activeDiffMode === "working" ? "working-tree" : activeDiffMode?.id ?? null}
                        {renamingPath}
                        {debugResult}
                        {debugging}
                        {ambiguityOverrides}
                        {importingLibrary}
                        {libraryNotice}
                        {relationGraph}
                        {behaviorSummary}
                        onJumpToFileLine={handleJumpToFileLine}
                        onPickFolder={() => void handlePickFolder()}
                        onRestoreSavedFolder={() => void handleRestoreSavedFolder()}
                        onCreateNewFile={() => void handleCreateNewFile()}
                        onSeedSampleFile={() => void handleSeedSampleFile()}
                        onSelectFile={(path) => {
                            const found = workspaceFiles.find((item) => item.path === path);

                            if (found) {
                                openWorkspaceFile(found);
                            }
                        }}
                        onDeleteFile={(path) => void handleDeleteFile(path)}
                        onStartRename={(path) => (renamingPath = path)}
                        onCommitRename={(oldPath, newName) => void handleCommitRename(oldPath, newName)}
                        onCancelRename={() => (renamingPath = null)}
                        onFileContextMenu={openFileContextMenu}
                        onExplorerContextMenu={openExplorerContextMenu}
                        onForkBaseLaw={(path) => void handleForkBaseLaw(path)}
                        onJumpToLine={(line, offset) => {
                            activeDiffMode = null;
                            editorRef?.focusLine(line, offset);
                        }}
                        onChangeContent={handleContentChange}
                        onCommit={(message) => void handleSave(message)}
                        onRestoreCommit={(commit) => {
                            content = commit.content;
                            title = extractHeaderTitle(commit.content) ?? title;
                            isDirty = true;
                            activeDiffMode = null;
                            void runAnalysis(false);
                        }}
                        onOpenWorkingDiff={() => (activeDiffMode = "working")}
                        onOpenCommitDiff={(commit) => (activeDiffMode = commit)}
                        onDiscardChanges={handleDiscardChanges}
                        onRunDebug={(scenario, useAi) => {
                            ambiguityOverrides = {};
                            void executeDebug(scenario, useAi, {});
                        }}
                        onChangeOverride={handleChangeOverride}
                        onImportLibrary={(payload) => void handleImportLibrary(payload)}
                        onImportLibraryBatch={(laws) => void handleImportLibraryBatch(laws)}
                        onImportLibraryZip={(file) => void handleImportLibraryZip(file)}
                        onDownloadSampleZip={handleDownloadSampleZip}
                        onDeleteLibrary={(path) => void handleDeleteFile(path)}
                        onInsertBasis={handleInsertBasis}
                    />
                </ResizablePane>
                <ResizableHandle class="hidden lg:flex" />
            {/if}

            <ResizablePane defaultSize={ideUi.sidebarOpen && showInspector ? 50 : 70} minSize={32}>
                <ResizablePaneGroup direction="vertical" class="h-full">
                    <ResizablePane defaultSize={66} minSize={30}>
                        <div class="flex h-full min-h-0 flex-col">
                            <EditorTabsBar
                                tabs={openTabViews}
                                activePath={activeFilePath || null}
                                diffTab={diffTabInfo}
                                activeDiffOpen={activeDiffMode !== null}
                                onSelectTab={switchToTab}
                                onCloseTab={closeTab}
                                onSelectDiffTab={() => {
                                    if (!activeDiffMode) {
                                        activeDiffMode = "working";
                                    }
                                }}
                                onCloseDiffTab={() => (activeDiffMode = null)}
                                onTabContextMenu={openTabContextMenu}
                            />

                            <div class="min-h-0 flex-1 overflow-hidden">
                                {#if activeDiffMode === "working"}
                                    <DiffViewer
                                        {title}
                                        {documentNumber}
                                        leftLabel="Bản gốc (Commit gần nhất)"
                                        rightLabel="Bản đang sửa (Working Tree)"
                                        {baseContent}
                                        currentContent={content}
                                        onClose={() => (activeDiffMode = null)}
                                        onRevertToBase={handleDiscardChanges}
                                    />
                                {:else if activeDiffMode}
                                    <DiffViewer
                                        {title}
                                        {documentNumber}
                                        leftLabel={`Commit: ${activeDiffMode.message}`}
                                        rightLabel="Bản đang sửa (Working Tree)"
                                        baseContent={activeDiffMode.content}
                                        currentContent={content}
                                        onClose={() => (activeDiffMode = null)}
                                    />
                                {:else if openTabs.length === 0 || !activeFilePath}
                                    <div class="flex h-full flex-col items-center justify-center gap-3 bg-[var(--ide-editor)] p-6 text-center text-xs text-muted-foreground">
                                        <p class="text-sm font-medium text-foreground">
                                            {workspaceFiles.length === 0 ? "Workspace đang trống" : "Chưa có tab văn bản nào đang mở"}
                                        </p>
                                        <p class="max-w-md">
                                            Chọn thư mục trên máy, tạo dự thảo mới hoặc nạp bộ dự thảo mẫu (gồm 6 văn bản nền và 4 dự thảo minh họa Linter, Lược đồ, Hành vi &amp; Sửa bằng AI).
                                        </p>
                                        <div class="mt-2 flex flex-wrap justify-center gap-2">
                                            <button
                                                type="button"
                                                onclick={() => void handleCreateNewFile()}
                                                class="flex h-8 items-center gap-1.5 rounded-[2px] bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                                            >
                                                <FilePlus2 class="size-3.5" aria-hidden="true" />
                                                <span>Tạo dự thảo mới</span>
                                            </button>
                                            <button
                                                type="button"
                                                onclick={() => void handleSeedSampleFile()}
                                                class="flex h-8 items-center gap-1.5 rounded-[2px] border border-border bg-secondary px-3 text-[11px] text-foreground hover:bg-accent"
                                            >
                                                <Sparkles class="size-3.5 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                                                <span>Nạp bộ dự thảo mẫu</span>
                                            </button>
                                            <button
                                                type="button"
                                                onclick={() => void handlePickFolder()}
                                                class="flex h-8 items-center gap-1.5 rounded-[2px] border border-border bg-secondary px-3 text-[11px] text-foreground hover:bg-accent"
                                            >
                                                <FolderOpen class="size-3.5" aria-hidden="true" />
                                                <span>Chọn thư mục trên máy</span>
                                            </button>
                                        </div>
                                    </div>
                                {:else}
                                    <LawEditor
                                        bind:this={editorRef}
                                        {title}
                                        {content}
                                        diagnostics={analysis?.diagnostics ?? []}
                                        termOccurrences={analysis?.termOccurrences ?? []}
                                        lineBehaviors={activeLineBehaviors}
                                        outline={analysis?.outline ?? []}
                                        {workspaceContext}
                                        activeRef={activeNode?.refLabel ?? null}
                                        {isDirty}
                                        {aiAuditing}
                                        {aiPhaseLabel}
                                        {selectedDiagnosticId}
                                        {cursorOffset}
                                        onChange={handleContentChange}
                                        onCursorChange={(offset) => (cursorOffset = offset)}
                                        onCursorDiagnostic={handleCursorDiagnostic}
                                        onSelectDiagnostic={handleSelectDiagnostic}
                                        onApplyQuickFix={handleApplyQuickFix}
                                        {fixingDiagnosticId}
                                        onAiFixDiagnostic={(diag) => void handleAiFixDiagnostic(diag)}
                                        onJumpToDefinition={(term) => {
                                            if (term.sourceDocumentPath && term.sourceLine) {
                                                handleJumpToFileLine(term.sourceDocumentPath, term.sourceLine);
                                            } else if (term.sourceLine) {
                                                editorRef?.focusLine(term.sourceLine);
                                            }
                                        }}
                                        onSelectBehavior={(bhv) => ideUi.focusBehavior(bhv.canonicalKey)}
                                        onOpenBehaviorsPanel={() => ideUi.openView("behaviors")}
                                        onCancelAi={() => aiAbortController?.abort()}
                                        onSaveShortcut={() => void handleSave()}
                                    />
                                {/if}
                            </div>
                        </div>
                    </ResizablePane>

                    <ResizableHandle />

                    <ResizablePane defaultSize={34} minSize={18}>
                        <ProblemsPanel
                            diagnostics={analysis?.diagnostics ?? []}
                            lean={analysis?.lean ?? null}
                            {selectedDiagnosticId}
                            {fixingDiagnosticId}
                            onSelectDiagnostic={handleSelectDiagnostic}
                            onJumpToLine={(line) => editorRef?.focusLine(line)}
                            onApplyQuickFix={handleApplyQuickFix}
                            onAiFixDiagnostic={(diag) => void handleAiFixDiagnostic(diag)}
                        />
                    </ResizablePane>
                </ResizablePaneGroup>
            </ResizablePane>

            {#if showInspector}
                <ResizableHandle class="hidden lg:flex" />
                <ResizablePane defaultSize={28} minSize={20} maxSize={42} class="hidden lg:block">
                    <InspectorPanel
                        {analysis}
                        {selectedDiagnosticId}
                        {fixingDiagnosticId}
                        onSelectDiagnostic={handleSelectDiagnostic}
                        onJumpToLine={(line, offset) => editorRef?.focusLine(line, offset)}
                        onApplyQuickFix={handleApplyQuickFix}
                        onAiFixDiagnostic={(diag) => void handleAiFixDiagnostic(diag)}
                    />
                </ResizablePane>
            {/if}
        </ResizablePaneGroup>
    </div>

    <IdeStatusBar
        {analysis}
        cursorLine={cursor.line}
        cursorCol={cursor.col}
        activeRef={activeNode?.refLabel ?? null}
        {analyzing}
        {aiAuditing}
        {aiPhaseLabel}
        tokenUsage={sessionTokenUsage}
    />
</div>

{#if contextMenu}
    <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        items={contextMenu.items}
        onClose={() => (contextMenu = null)}
    />
{/if}

{#if previewHtml !== null}
    <ExportPreviewModal
        html={previewHtml}
        {title}
        onExportDocx={handleExportDocx}
        onPrintPdf={() => triggerPrintHtml(previewHtml!)}
        onClose={() => (previewHtml = null)}
    />
{/if}

{#if !localSettings.onboarded || !localSettings.hasApiKey || ideUi.settingsOpen}
    <OnboardingModal
        {folderName}
        {folderMode}
        fileCount={workspaceFiles.length}
        libraryCount={workspaceFiles.filter((f) => f.isLibrary).length}
        canClose={localSettings.onboarded && localSettings.hasApiKey}
        authErrorMessage={tokenInvalid ? bannerError : null}
        onPickFolder={() => void handlePickFolder()}
        onSeedSampleWorkspace={() => void handleSeedSampleFile()}
        onSaved={() => {
            tokenInvalid = false;
            bannerError = null;

            if (activeFilePath || content.trim()) {
                handleRefreshEngine();
            }
        }}
        onClose={() => ideUi.closeSettings()}
    />
{/if}
