<script lang="ts">
    import type { ModelOptions } from "$lib/api/models";
    import { Button } from "$lib/components/ui/button";
    import {
        BugPlay,
        ChevronDown,
        Download,
        Eye,
        FileText,
        KeyRound,
        Loader,
        PanelLeft,
        PanelRight,
        Plus,
        Printer,
        RefreshCw,
        Save,
        ShieldCheck,
    } from "@lucide/svelte";

    type Props = {
        title: string;
        documentNumber: string;
        isTemplate: boolean;
        isDirty: boolean;
        analyzing: boolean;
        aiAuditing: boolean;
        debugging: boolean;
        saving: boolean;
        exporting: boolean;
        models: ModelOptions["models"];
        selectedModel: string;
        tokenInvalid?: boolean;
        showSidebar: boolean;
        showInspector: boolean;
        onTitleChange: (value: string) => void;
        onDocNumberChange: (value: string) => void;
        onRefreshEngine: () => void;
        onOpenSettings: () => void;
        onRunDebug: () => void;
        onSave: () => void;
        onNewDraft: () => void;
        onExportDocx: () => void;
        onExportPdf: () => void;
        onPreviewExport: () => void;
        onModelChange: (value: string) => void;
        onToggleSidebar: () => void;
        onToggleInspector: () => void;
    };

    let {
        title,
        documentNumber,
        isTemplate,
        isDirty,
        analyzing,
        aiAuditing,
        debugging,
        saving,
        exporting,
        models,
        selectedModel,
        tokenInvalid = false,
        showSidebar,
        showInspector,
        onTitleChange,
        onDocNumberChange,
        onRefreshEngine,
        onOpenSettings,
        onRunDebug,
        onSave,
        onNewDraft,
        onExportDocx,
        onExportPdf,
        onPreviewExport,
        onModelChange,
        onToggleSidebar,
        onToggleInspector,
    }: Props = $props();

    let exportMenuOpen = $state(false);
</script>

<header class="flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-[var(--ide-chrome)] px-2.5 text-xs">
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <button
            type="button"
            onclick={onToggleSidebar}
            title={showSidebar ? "Ẩn thanh bên trái" : "Hiện thanh bên trái"}
            class="hidden size-7 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
        >
            <PanelLeft class="size-4" aria-hidden="true" />
        </button>

        <span class="hidden rounded-[2px] bg-primary/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary sm:inline">
            LexIDE
        </span>

        <input
            type="text"
            value={title}
            placeholder="Chưa mở văn bản..."
            oninput={(event) => onTitleChange(event.currentTarget.value)}
            aria-label="Tên dự thảo"
            class="min-w-0 max-w-[240px] truncate rounded-[2px] border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium hover:border-border focus:border-ring focus:bg-background focus:outline-none sm:max-w-[300px]"
        />
        {#if isDirty}
            <span class="size-2 shrink-0 rounded-full bg-[var(--diag-loophole)]" title="Có thay đổi chưa lưu"></span>
        {/if}

        <input
            type="text"
            value={documentNumber}
            placeholder="Số hiệu..."
            oninput={(event) => onDocNumberChange(event.currentTarget.value)}
            aria-label="Số hiệu văn bản"
            class="hidden w-32 rounded-[2px] border border-border/80 bg-background/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground focus:border-ring focus:text-foreground focus:outline-none xl:block"
        />

        <span
            title="Thẩm định và gợi ý chỉ sử dụng văn bản có trong workspace"
            class="hidden items-center gap-1 rounded-[2px] border border-border bg-secondary/70 px-1.5 py-0.5 text-[10px] text-muted-foreground 2xl:flex"
        >
            <ShieldCheck class="size-3 text-[var(--diag-ok)]" aria-hidden="true" />
            <span>Workspace Only</span>
        </span>
    </div>

    <div class="flex shrink-0 items-center gap-1">
        <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={onRunDebug}
            disabled={debugging}
            title="Chạy bộ luật với tình huống thực tế (F5)"
            class="h-7 gap-1 rounded-[2px] border-[#388a34]/50 bg-[#388a34]/15 px-2 text-[11px] text-[var(--diag-ok)] hover:bg-[#388a34]/25"
        >
            {#if debugging}
                <Loader class="size-3 animate-spin" aria-hidden="true" />
            {:else}
                <BugPlay class="size-3.5" aria-hidden="true" />
            {/if}
            <span class="hidden sm:inline">Chạy thử (F5)</span>
        </Button>

        {#if models.length > 0}
            <div class="hidden h-7 items-center md:flex">
                <div class="relative flex h-7 items-center">
                    <select
                        value={selectedModel}
                        onchange={(event) => onModelChange(event.currentTarget.value)}
                        aria-label="Mô hình thẩm định AI"
                        class="h-7 max-w-[118px] cursor-pointer appearance-none truncate rounded-l-[2px] rounded-r-none border border-r-0 border-input bg-background pr-6 pl-2 text-[11px] leading-none text-foreground focus:border-ring focus:outline-none"
                    >
                        {#each models as model (model.id)}
                            <option value={model.id}>{model.label}</option>
                        {/each}
                    </select>
                    <ChevronDown class="pointer-events-none absolute right-1.5 size-3 text-muted-foreground" aria-hidden="true" />
                </div>
                <Button
                    type="button"
                    size="sm"
                    onclick={onRefreshEngine}
                    disabled={analyzing || aiAuditing}
                    title="Làm mới toàn bộ bộ máy kiểm định (Tầng 0 + Lean 4, kèm AI nếu đã nhập API Key)"
                    class="h-7 gap-1 rounded-l-none rounded-r-[2px] px-2 text-[11px]"
                >
                    <RefreshCw class="size-3 {analyzing || aiAuditing ? 'animate-spin' : ''}" aria-hidden="true" />
                    <span>{analyzing || aiAuditing ? "Đang quét..." : "Quét lại"}</span>
                </Button>
            </div>
        {:else}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onclick={onRefreshEngine}
                disabled={analyzing || aiAuditing}
                title="Làm mới toàn bộ bộ máy kiểm định (Tầng 0 + Lean 4)"
                class="h-7 gap-1 rounded-[2px] px-2 text-[11px]"
            >
                <RefreshCw class="size-3 {analyzing || aiAuditing ? 'animate-spin' : ''}" aria-hidden="true" />
                <span class="hidden sm:inline">{analyzing || aiAuditing ? "Đang quét..." : "Quét lại"}</span>
            </Button>
        {/if}

        <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={onOpenSettings}
            title={tokenInvalid ? "Gemini API Token hết hạn hoặc không hợp lệ — bấm để đổi token mới" : "Đổi / cập nhật Gemini API Token"}
            class={`relative h-7 gap-1 rounded-[2px] px-2 text-[11px] ${
                tokenInvalid
                    ? "border-destructive/70 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : ""
            }`}
        >
            <KeyRound class="size-3" aria-hidden="true" />
            <span class="hidden xl:inline">{tokenInvalid ? "Đổi Token" : "API Key"}</span>
            {#if tokenInvalid}
                <span class="size-1.5 rounded-full bg-destructive" aria-hidden="true"></span>
            {/if}
        </Button>

        <Button type="button" variant="secondary" size="sm" onclick={onSave} disabled={saving} class="h-7 gap-1 rounded-[2px] px-2 text-[11px]">
            {#if saving}
                <Loader class="size-3 animate-spin" aria-hidden="true" />
            {:else}
                <Save class="size-3" aria-hidden="true" />
            {/if}
            <span class="hidden sm:inline">{isTemplate ? "Lưu thành bản mới" : "Lưu"}</span>
        </Button>

        <div class="relative">
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onclick={() => (exportMenuOpen = !exportMenuOpen)}
                title="Xuất văn bản chuẩn Nghị định 30/2020/NĐ-CP (Times New Roman)"
                class="h-7 gap-1 rounded-[2px] px-2 text-[11px]"
            >
                {#if exporting}
                    <Loader class="size-3 animate-spin" aria-hidden="true" />
                {:else}
                    <Download class="size-3" aria-hidden="true" />
                {/if}
                <span class="hidden sm:inline">Xuất</span>
                <ChevronDown class="size-3 text-muted-foreground" aria-hidden="true" />
            </Button>

            {#if exportMenuOpen}
                <button
                    type="button"
                    aria-label="Đóng menu xuất"
                    onclick={() => (exportMenuOpen = false)}
                    class="fixed inset-0 z-30 cursor-default"
                ></button>
                <div class="absolute right-0 z-40 mt-1 w-64 rounded-[2px] border border-border bg-[var(--ide-panel)] p-1 shadow-xl">
                    <button
                        type="button"
                        onclick={() => {
                            exportMenuOpen = false;
                            onExportDocx();
                        }}
                        class="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-accent"
                    >
                        <FileText class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span>Xuất Word (.docx — Times New Roman)</span>
                    </button>
                    <button
                        type="button"
                        onclick={() => {
                            exportMenuOpen = false;
                            onExportPdf();
                        }}
                        class="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-accent"
                    >
                        <Printer class="size-3.5 shrink-0 text-[var(--diag-ok)]" aria-hidden="true" />
                        <span>Xuất PDF (.pdf — Chuẩn A4)</span>
                    </button>
                    <button
                        type="button"
                        onclick={() => {
                            exportMenuOpen = false;
                            onPreviewExport();
                        }}
                        class="flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-[11px] text-foreground hover:bg-accent"
                    >
                        <Eye class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span>Xem trước bản in A4</span>
                    </button>
                </div>
            {/if}
        </div>

        <Button type="button" variant="ghost" size="sm" onclick={onNewDraft} title="Tạo dự thảo trắng mới" class="h-7 gap-1 rounded-[2px] px-2 text-[11px]">
            <Plus class="size-3.5" aria-hidden="true" />
            <span class="hidden xl:inline">Mới</span>
        </Button>

        <button
            type="button"
            onclick={onToggleInspector}
            title={showInspector ? "Ẩn bảng phân tích" : "Hiện bảng phân tích"}
            class="hidden size-7 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground lg:flex"
        >
            <PanelRight class="size-4" aria-hidden="true" />
        </button>
    </div>
</header>
