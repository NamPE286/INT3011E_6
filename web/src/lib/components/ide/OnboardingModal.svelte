<script lang="ts">
    import { LOCAL_MODEL_OPTIONS, localSettings } from "$lib/local-settings.svelte";
    import { Eye, EyeOff, FolderOpen, KeyRound, ShieldCheck, Sparkles, X } from "@lucide/svelte";

    type Props = {
        folderName: string | null;
        folderMode: "disk" | "virtual";
        fileCount: number;
        libraryCount: number;
        canClose: boolean;
        authErrorMessage?: string | null;
        onPickFolder: () => void;
        onSeedSampleWorkspace: () => void;
        onSaved?: () => void;
        onClose: () => void;
    };

    let {
        folderName,
        folderMode,
        fileCount,
        libraryCount,
        canClose,
        authErrorMessage = null,
        onPickFolder,
        onSeedSampleWorkspace,
        onSaved,
        onClose,
    }: Props = $props();

    let apiKey = $state(localSettings.apiKey);
    let apiBaseUrl = $state(localSettings.apiBaseUrl);
    let model = $state(localSettings.model);
    let autoLlm = $state(localSettings.autoLlm);
    let useDecisionApi = $state(localSettings.useDecisionApi);
    let showKey = $state(false);
    let validationError = $state<string | null>(null);

    function handleSaveAndStart(event: SubmitEvent): void {
        event.preventDefault();

        if (!apiKey.trim()) {
            validationError = "Vui lòng nhập Gemini API Token của bạn để bắt đầu sử dụng LexIDE.";

            return;
        }

        validationError = null;
        localSettings.saveAll({ apiKey, apiBaseUrl, model, autoLlm, useDecisionApi });
        onSaved?.();
        onClose();
    }
</script>

<div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Thiết lập LexIDE Local-First"
>
    <div class="w-full max-w-xl overflow-hidden rounded-[4px] border border-border bg-[var(--ide-panel)] text-xs shadow-2xl">
        <div class="flex h-11 items-center justify-between border-b bg-[var(--ide-chrome)] px-4">
            <div class="flex items-center gap-2">
                <ShieldCheck class="size-4 text-[var(--diag-ok)]" aria-hidden="true" />
                <span class="text-sm font-semibold text-foreground">
                    {canClose ? "Cài đặt LexIDE & Gemini API Token" : "Chào mừng đến với LexIDE (Local-First)"}
                </span>
            </div>
            {#if canClose}
                <button
                    type="button"
                    onclick={onClose}
                    title="Đóng cài đặt"
                    class="rounded-[2px] p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X class="size-4" aria-hidden="true" />
                </button>
            {/if}
        </div>

        <form onsubmit={handleSaveAndStart} class="flex flex-col gap-4 p-4">
            <div class="rounded-[2px] border border-border/80 bg-background/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
                <p class="font-semibold text-foreground">100% Engine chạy cục bộ trên máy của bạn</p>
                <p class="mt-1">
                    Không cần đăng nhập. Kiểm định Tầng 0, biên dịch <strong>Lean 4 (0 token)</strong>, Run &amp; Debug, Diff, giải nén
                    <code>.zip</code> và xuất Word/PDF đều xử lý trực tiếp trên trình duyệt. Tầng 1 (<code>gemini-decision-1</code>) và Tầng 2 (Neuro-Symbolic) gọi trực tiếp bằng <strong>Gemini API Token do bạn tự cung cấp</strong> (lưu cục bộ trên trình duyệt).
                </p>
            </div>

            <section class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <span class="font-semibold text-foreground">1. Thư mục làm việc trên máy (Local Folder)</span>
                    <span class="font-mono text-[10px] text-muted-foreground">
                        {folderMode === "disk" && folderName
                            ? `Đang mở: ${folderName} (${fileCount} tệp · ${libraryCount} thư viện)`
                            : `Workspace trình duyệt (${fileCount} tệp)`}
                    </span>
                </div>

                <div class="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onclick={onPickFolder}
                        class="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[2px] border border-primary/60 bg-primary/15 px-3 font-medium text-primary hover:bg-primary/25"
                    >
                        <FolderOpen class="size-4" aria-hidden="true" />
                        <span>{folderName ? `Đổi thư mục (${folderName})` : "Chọn thư mục trên máy..."}</span>
                    </button>

                    <button
                        type="button"
                        onclick={onSeedSampleWorkspace}
                        class="flex h-8 items-center gap-1.5 rounded-[2px] border border-border bg-secondary px-3 text-[11px] text-foreground hover:bg-accent"
                    >
                        <Sparkles class="size-3.5 text-[var(--diag-ambiguity)]" aria-hidden="true" />
                        <span>Nạp bộ dự thảo mẫu</span>
                    </button>
                </div>
            </section>

            <section class="flex flex-col gap-2 border-t pt-3">
                {#if authErrorMessage}
                    <div class="rounded-[2px] border border-destructive/50 bg-destructive/15 px-3 py-2 text-[11px] text-destructive">
                        {authErrorMessage}
                    </div>
                {/if}

                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                        <KeyRound class="size-3.5 text-primary" aria-hidden="true" />
                        <span class="font-semibold text-foreground">2. Gemini API Token (Bắt buộc)</span>
                    </div>
                    <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[10px] text-primary underline hover:opacity-80"
                    >
                        Lấy key miễn phí tại Google AI Studio
                    </a>
                </div>

                <div class="relative flex items-center">
                    <input
                        type={showKey ? "text" : "password"}
                        bind:value={apiKey}
                        oninput={() => {
                            if (validationError) {
                                validationError = null;
                            }
                        }}
                        required
                        placeholder="Nhập Gemini API Key từ Google AI Studio (bắt buộc)..."
                        autocomplete="off"
                        class="h-8 w-full rounded-[2px] border border-input bg-background pr-14 pl-2.5 font-mono text-[11px] focus:border-ring focus:outline-none"
                    />
                    {#if apiKey.length > 0}
                        <button
                            type="button"
                            onclick={() => {
                                apiKey = "";
                                validationError = null;
                            }}
                            title="Xóa token cũ"
                            class="absolute right-7 text-muted-foreground hover:text-foreground"
                        >
                            <X class="size-3.5" aria-hidden="true" />
                        </button>
                    {/if}
                    <button
                        type="button"
                        onclick={() => (showKey = !showKey)}
                        title={showKey ? "Ẩn token" : "Hiện token"}
                        class="absolute right-2 text-muted-foreground hover:text-foreground"
                    >
                        {#if showKey}
                            <EyeOff class="size-3.5" aria-hidden="true" />
                        {:else}
                            <Eye class="size-3.5" aria-hidden="true" />
                        {/if}
                    </button>
                </div>

                {#if validationError}
                    <p class="text-[11px] font-medium text-[var(--diag-logic)]">{validationError}</p>
                {/if}

                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-muted-foreground">Model mặc định</span>
                        <select
                            bind:value={model}
                            class="h-7 rounded-[2px] border border-input bg-background px-2 text-[11px] text-foreground focus:border-ring focus:outline-none"
                        >
                            {#each LOCAL_MODEL_OPTIONS as item (item.id)}
                                <option value={item.id}>{item.label}</option>
                            {/each}
                        </select>
                    </label>

                    <label class="flex flex-col gap-1">
                        <span class="text-[10px] text-muted-foreground">API Base URL (Gemini)</span>
                        <input
                            type="url"
                            bind:value={apiBaseUrl}
                            placeholder="https://generativelanguage.googleapis.com"
                            class="h-7 rounded-[2px] border border-input bg-background px-2 font-mono text-[11px] focus:border-ring focus:outline-none"
                        />
                    </label>
                </div>

                <label class="mt-1 flex items-center gap-2 text-[11px] text-foreground select-none">
                    <input type="checkbox" bind:checked={autoLlm} class="size-3.5 accent-primary" />
                    <span>Tự động chạy LLM Extract khi sửa văn bản (chỉ gửi khoản mới/thay đổi, cache khoản cũ)</span>
                </label>

                <label class="flex items-center gap-2 text-[11px] text-foreground select-none">
                    <input type="checkbox" bind:checked={useDecisionApi} class="size-3.5 accent-primary" />
                    <span>Dùng Gemini Decision API (0 output token) để sàng lọc trước khi trích xuất</span>
                </label>
            </section>

            <div class="flex items-center justify-end gap-2 border-t pt-3">
                <button
                    type="submit"
                    disabled={!apiKey.trim()}
                    class="h-8 rounded-[2px] bg-primary px-4 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {canClose ? "Cập nhật Token & Quét lại" : "Lưu & Mở LexIDE"}
                </button>
            </div>
        </form>
    </div>
</div>
