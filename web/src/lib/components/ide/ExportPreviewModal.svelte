<script lang="ts">
    import { FileText, Printer, X } from "@lucide/svelte";

    type Props = {
        html: string;
        title: string;
        onExportDocx: () => void;
        onPrintPdf: () => void;
        onClose: () => void;
    };

    let { html, title, onExportDocx, onPrintPdf, onClose }: Props = $props();

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            onClose();
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Xem trước bản in văn bản pháp luật A4"
>
    <div class="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[4px] border border-border bg-[var(--ide-panel)] shadow-2xl">
        <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-[var(--ide-chrome)] px-3 text-xs">
            <div class="flex min-w-0 items-center gap-2">
                <FileText class="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span class="truncate font-semibold text-foreground">Xem trước chuẩn Nghị định 30/2020/NĐ-CP (Times New Roman 14pt — A4)</span>
                <span class="hidden truncate text-muted-foreground sm:inline">· {title}</span>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
                <button
                    type="button"
                    onclick={onExportDocx}
                    class="flex h-7 items-center gap-1 rounded-[2px] border border-border bg-secondary px-2.5 text-[11px] font-medium text-foreground hover:bg-accent"
                >
                    <FileText class="size-3.5" aria-hidden="true" />
                    <span>Tải Word (.docx)</span>
                </button>
                <button
                    type="button"
                    onclick={onPrintPdf}
                    class="flex h-7 items-center gap-1 rounded-[2px] bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                >
                    <Printer class="size-3.5" aria-hidden="true" />
                    <span>In / Lưu PDF</span>
                </button>
                <button
                    type="button"
                    onclick={onClose}
                    title="Đóng xem trước (Esc)"
                    class="flex size-7 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X class="size-4" aria-hidden="true" />
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-auto bg-[#525659] p-4 sm:p-6">
            <div class="mx-auto h-full min-h-[760px] w-full max-w-[210mm] overflow-hidden rounded-[2px] bg-white shadow-xl">
                <iframe
                    srcdoc={html}
                    title="Xem trước văn bản A4"
                    class="h-full w-full border-0 bg-white"
                ></iframe>
            </div>
        </div>
    </div>
</div>
