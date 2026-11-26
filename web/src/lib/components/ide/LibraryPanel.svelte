<script lang="ts">
    import type { WorkspaceContext } from "$lib/api/ide";
    import type { LocalWorkspaceFile } from "$lib/engine/local-workspace";
    import { BookOpen, FileArchive, FilePlus2, FileUp, GitFork, Loader, Plus, Trash2, X } from "@lucide/svelte";

    type BatchLawItem = {
        title: string;
        documentNumber: string;
        documentType: string;
        content: string;
    };

    type Props = {
        libraryFiles: LocalWorkspaceFile[];
        workspaceContext: WorkspaceContext | null;
        importing: boolean;
        lastImportMessage?: string | null;
        onImportLibrary: (payload: BatchLawItem) => void;
        onImportLibraryBatch: (laws: BatchLawItem[]) => void;
        onImportLibraryZip: (file: File) => void;
        onDownloadSampleZip: () => void;
        onDeleteLibrary: (path: string) => void;
        onForkBaseLaw: (path: string) => void;
        onInsertBasis: (basisLine: string) => void;
    };

    let {
        libraryFiles,
        workspaceContext,
        importing,
        lastImportMessage = null,
        onImportLibrary,
        onImportLibraryBatch,
        onImportLibraryZip,
        onDownloadSampleZip,
        onDeleteLibrary,
        onForkBaseLaw,
        onInsertBasis,
    }: Props = $props();

    let title = $state("");
    let documentNumber = $state("");
    let documentType = $state("Luật");
    let content = $state("");
    let pendingBatch = $state<BatchLawItem[]>([]);
    let dragOver = $state(false);
    let fileInputEl = $state<HTMLInputElement | null>(null);

    function fillSampleBaseLaw(): void {
        title = "Luật Trật tự, an toàn giao thông đường bộ";
        documentNumber = "36/2024/QH15";
        documentType = "Luật";
        content = `Điều 1. Giải thích từ ngữ
1. Điểm giấy phép lái xe là thang gồm 12 điểm trong 01 năm để theo dõi việc chấp hành pháp luật về trật tự, an toàn giao thông đường bộ của người lái xe.
2. Xe tự hành là phương tiện giao thông đường bộ có hệ thống điều khiển tự động vận hành không cần tác động trực tiếp liên tục của người lái.
3. Hệ thống hỗ trợ lái là tập hợp cảm biến và phần mềm cảnh báo, hỗ trợ kiểm soát tốc độ và làn đường cho người điều khiển.`;
    }

    function inferMetadataFromFile(filename: string, rawText: string, index: number): BatchLawItem {
        const cleanBase = filename.replace(/\.[^.]+$/, "").trim();
        const headerLines = rawText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 10);
        const numberMatch = /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u.exec(headerLines.join("\n"))
            ?? /\b(\d{1,4}\/\d{4}\/[A-ZĐ0-9\-]+)\b/u.exec(cleanBase.replace(/-/g, "/"));
        const inferredNumber = numberMatch?.[1] ?? `LIB-${String(index).padStart(2, "0")}/2026`;
        const firstLine = (headerLines[0] ?? cleanBase).replace(/^#+\s*/, "").trim();
        const inferredTitle = /^(?:Điều|Chương)\s+\d+/iu.test(firstLine) ? cleanBase : firstLine.slice(0, 160);
        const typeHint = `${inferredTitle} ${inferredNumber}`;
        const inferredType = /Nghị định|NĐ-CP/iu.test(typeHint)
            ? "Nghị định"
            : /Thông tư/iu.test(typeHint)
              ? "Thông tư"
              : "Luật";

        return {
            title: inferredTitle || cleanBase,
            documentNumber: inferredNumber,
            documentType: inferredType,
            content: rawText.trim(),
        };
    }

    async function processFiles(fileList: FileList | File[]): Promise<void> {
        const files = Array.from(fileList);

        if (files.length === 0) {
            return;
        }

        const zipFile = files.find((file) => file.name.toLowerCase().endsWith(".zip"));

        if (zipFile) {
            onImportLibraryZip(zipFile);

            return;
        }

        if (files.length === 1 && !files[0].name.toLowerCase().endsWith(".json")) {
            const text = await files[0].text();
            const inferred = inferMetadataFromFile(files[0].name, text, 1);
            content = inferred.content;

            if (!title.trim()) {
                title = inferred.title;
            }

            if (!documentNumber.trim()) {
                documentNumber = inferred.documentNumber;
            }

            documentType = inferred.documentType;

            return;
        }

        const nextItems: BatchLawItem[] = [];

        for (const file of files) {
            const text = await file.text();

            if (!text.trim()) {
                continue;
            }

            if (file.name.toLowerCase().endsWith(".json")) {
                try {
                    const parsed = JSON.parse(text) as unknown;
                    const arr = Array.isArray(parsed) ? parsed : [parsed];

                    for (const entry of arr) {
                        if (typeof entry === "object" && entry !== null && typeof (entry as { content?: unknown }).content === "string") {
                            const rec = entry as Record<string, unknown>;
                            nextItems.push({
                                title: typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : file.name,
                                documentNumber: typeof rec.documentNumber === "string" && rec.documentNumber.trim()
                                    ? rec.documentNumber.trim()
                                    : `LIB-${String(nextItems.length + 1).padStart(2, "0")}/2026`,
                                documentType: typeof rec.documentType === "string" && rec.documentType.trim() ? rec.documentType.trim() : "Luật",
                                content: (rec.content as string).trim(),
                            });
                        }
                    }
                } catch {
                    continue;
                }
            } else {
                nextItems.push(inferMetadataFromFile(file.name, text, nextItems.length + 1));
            }
        }

        if (nextItems.length > 0) {
            pendingBatch = [...pendingBatch, ...nextItems];
        }
    }

    async function handleFileSelect(event: Event): Promise<void> {
        const input = event.currentTarget;

        if (!(input instanceof HTMLInputElement) || !input.files) {
            return;
        }

        await processFiles(input.files);
        input.value = "";
    }

    async function handleDrop(event: DragEvent): Promise<void> {
        event.preventDefault();
        dragOver = false;

        if (event.dataTransfer?.files) {
            await processFiles(event.dataTransfer.files);
        }
    }

    function submitBatch(): void {
        if (importing || pendingBatch.length === 0) {
            return;
        }

        onImportLibraryBatch(pendingBatch);
        pendingBatch = [];
    }

    function submit(event: SubmitEvent): void {
        event.preventDefault();

        if (importing || !title.trim() || !documentNumber.trim() || !content.trim()) {
            return;
        }

        onImportLibrary({
            title: title.trim(),
            documentNumber: documentNumber.trim(),
            documentType: documentType.trim() || "Luật",
            content: content.trim(),
        });

        title = "";
        documentNumber = "";
        content = "";
    }
</script>

<div class="flex h-full flex-col bg-[var(--ide-panel)] text-xs">
    <div class="flex h-9 shrink-0 items-center justify-between border-b px-3 select-none">
        <span class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Library (Luật nền)</span>
        <span class="font-mono text-[10px] text-muted-foreground">{libraryFiles.length} văn bản</span>
    </div>

    <div class="ide-scroll flex-1 overflow-y-auto p-2.5">
        {#if lastImportMessage}
            <div class="mb-2 rounded-[2px] border border-[var(--diag-ok)]/40 bg-[var(--diag-ok-bg)] px-2 py-1.5 text-[11px] text-[var(--diag-ok)]">
                {lastImportMessage}
            </div>
        {/if}

        <div class="mb-3 flex flex-col gap-1.5 border-b pb-3">
            <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-semibold text-foreground">Import 1 / nhiều luật hoặc gói .zip</span>
                <button
                    type="button"
                    onclick={onDownloadSampleZip}
                    class="flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                    <FileArchive class="size-3" aria-hidden="true" />
                    <span>Tải .zip mẫu</span>
                </button>
            </div>

            <input
                bind:this={fileInputEl}
                type="file"
                accept=".zip,.txt,.md,.luat,.json"
                multiple
                onchange={handleFileSelect}
                class="hidden"
            />
            <button
                type="button"
                onclick={() => fileInputEl?.click()}
                ondragover={(event) => {
                    event.preventDefault();
                    dragOver = true;
                }}
                ondragleave={() => (dragOver = false)}
                ondrop={handleDrop}
                disabled={importing}
                class={`flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-[2px] border border-dashed px-2 py-1.5 text-center text-[11px] transition-colors ${
                    dragOver
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background/50 text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
            >
                <div class="flex items-center gap-1.5">
                    <FileUp class="size-3.5" aria-hidden="true" />
                    <span>Chọn 1/nhiều tệp luật hoặc gói .zip</span>
                </div>
                <span class="text-[10px] text-muted-foreground">Hỗ trợ .zip (nhiều luật), .txt, .md, .luat, .json</span>
            </button>

            {#if pendingBatch.length > 0}
                <div class="rounded-[2px] border bg-background/70 p-2">
                    <p class="mb-1 text-[10px] font-semibold text-foreground uppercase">
                        Hàng chờ import ({pendingBatch.length} bộ luật)
                    </p>
                    <ul class="mb-2 flex max-h-28 flex-col gap-1 overflow-y-auto">
                        {#each pendingBatch as item, idx (`${item.documentNumber}-${idx}`)}
                            <li class="flex items-center justify-between gap-1 rounded-[2px] border bg-background px-1.5 py-1 text-[10px]">
                                <span class="min-w-0 flex-1 truncate">{item.title} ({item.documentNumber})</span>
                                <button
                                    type="button"
                                    onclick={() => (pendingBatch = pendingBatch.filter((_, i) => i !== idx))}
                                    title="Bỏ khỏi hàng chờ"
                                    class="shrink-0 text-muted-foreground hover:text-destructive"
                                >
                                    <X class="size-3" aria-hidden="true" />
                                </button>
                            </li>
                        {/each}
                    </ul>
                    <button
                        type="button"
                        disabled={importing}
                        onclick={submitBatch}
                        class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[2px] bg-primary font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                        {#if importing}
                            <Loader class="size-3.5 animate-spin" aria-hidden="true" />
                            <span>Đang nạp hàng loạt...</span>
                        {:else}
                            <FilePlus2 class="size-3.5" aria-hidden="true" />
                            <span>Import {pendingBatch.length} bộ luật vào Workspace</span>
                        {/if}
                    </button>
                </div>
            {/if}
        </div>

        <form onsubmit={submit} class="flex flex-col gap-2 border-b pb-3">
            <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-semibold text-foreground">Hoặc nhập nhanh 1 bộ luật</span>
                <button
                    type="button"
                    onclick={fillSampleBaseLaw}
                    class="text-[10px] text-primary hover:underline"
                >
                    Điền mẫu Luật nền
                </button>
            </div>

            <input
                type="text"
                bind:value={title}
                placeholder="Tên bộ luật (vd: Luật TTATGTĐB)..."
                required
                class="h-7 rounded-[2px] border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
            />

            <div class="flex gap-1.5">
                <input
                    type="text"
                    bind:value={documentNumber}
                    placeholder="Số hiệu (36/2024/QH15)"
                    required
                    class="h-7 min-w-0 flex-1 rounded-[2px] border border-input bg-background px-2 font-mono text-[11px] focus:border-ring focus:outline-none"
                />
                <select
                    bind:value={documentType}
                    aria-label="Loại văn bản"
                    class="h-7 rounded-[2px] border border-input bg-background px-1.5 text-[11px]"
                >
                    <option value="Luật">Luật</option>
                    <option value="Nghị định">Nghị định</option>
                    <option value="Thông tư">Thông tư</option>
                </select>
            </div>

            <textarea
                bind:value={content}
                rows={4}
                required
                placeholder="Dán nội dung Điều / Khoản / Giải thích từ ngữ của bộ luật nền..."
                class="w-full resize-none rounded-[2px] border border-input bg-background p-2 text-[11px] leading-relaxed focus:border-ring focus:outline-none"
            ></textarea>

            <button
                type="submit"
                disabled={importing || !title.trim() || !documentNumber.trim() || !content.trim()}
                class="flex h-7 w-full items-center justify-center gap-1.5 rounded-[2px] bg-primary font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
                {#if importing}
                    <Loader class="size-3.5 animate-spin" aria-hidden="true" />
                    <span>Đang nạp vào Workspace...</span>
                {:else}
                    <FilePlus2 class="size-3.5" aria-hidden="true" />
                    <span>Import vào Workspace</span>
                {/if}
            </button>
        </form>

        <section class="mt-3">
            <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                Bộ luật trong thư mục Library ({libraryFiles.length})
            </p>
            {#if libraryFiles.length === 0}
                <p class="rounded-[2px] border bg-background/50 p-2.5 text-[11px] text-muted-foreground">
                    Thư mục <code>library/</code> chưa có bộ luật nền nào. Hãy import bộ luật hoặc gói <code>.zip</code> ở trên để làm căn cứ và định nghĩa thuật ngữ (như Điểm GPLX).
                </p>
            {:else}
                <ul class="flex flex-col gap-1.5">
                    {#each libraryFiles as doc (doc.path)}
                        <li class="rounded-[2px] border bg-background/70 p-2">
                            <div class="flex items-start justify-between gap-1.5">
                                <div class="flex min-w-0 items-center gap-1.5">
                                    <BookOpen class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                    <div class="min-w-0 flex-1">
                                        <p class="truncate font-medium text-foreground">{doc.title}</p>
                                        <p class="truncate font-mono text-[10px] text-muted-foreground">{doc.documentNumber ?? doc.path}</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onclick={() => onDeleteLibrary(doc.path)}
                                    title="Xóa khỏi thư mục Library"
                                    class="shrink-0 rounded-[2px] p-0.5 text-muted-foreground hover:text-destructive"
                                >
                                    <Trash2 class="size-3" aria-hidden="true" />
                                </button>
                            </div>

                            <div class="mt-2 flex flex-wrap gap-1.5">
                                <button
                                    type="button"
                                    onclick={() =>
                                        onInsertBasis(
                                            `Căn cứ ${doc.documentType ?? "Văn bản"} số ${doc.documentNumber ?? doc.title};`,
                                        )
                                    }
                                    class="flex items-center gap-1 rounded-[2px] border bg-secondary px-1.5 py-0.5 text-[10px] hover:bg-accent"
                                >
                                    <Plus class="size-3" aria-hidden="true" />
                                    <span>Chèn Căn cứ</span>
                                </button>
                                <button
                                    type="button"
                                    onclick={() => onForkBaseLaw(doc.path)}
                                    class="flex items-center gap-1 rounded-[2px] border bg-secondary px-1.5 py-0.5 text-[10px] hover:bg-accent"
                                >
                                    <GitFork class="size-3" aria-hidden="true" />
                                    <span>Xây trên luật này</span>
                                </button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>

        {#if workspaceContext && workspaceContext.definedTerms.length > 0}
            <section class="mt-4">
                <p class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Thuật ngữ đã định nghĩa ({workspaceContext.definedTerms.length})
                </p>
                <ul class="flex flex-col gap-1">
                    {#each workspaceContext.definedTerms as item (item.normalizedTerm)}
                        <li class="rounded-[2px] border bg-background/50 px-2 py-1.5">
                            <p class="font-medium text-[var(--diag-ok)]">{item.term}</p>
                            <p class="mt-0.5 text-[10px] text-muted-foreground">{item.sourceLabel}</p>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}
    </div>
</div>
