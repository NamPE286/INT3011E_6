<script lang="ts">
    import type { PreprocessingStage, StageStatus } from "$lib/api/review";
    import { Badge } from "$lib/components/ui/badge";

    let { stages }: { stages: PreprocessingStage[] } = $props();

    const STAGE_LABELS: Record<string, string> = {
        PROVISIONS: "Điều/Khoản/Điểm",
        DOCUMENT_GRAPH: "Quan hệ văn bản",
        CHANGE_GRAPH: "Sửa đổi, bổ sung",
        VIOLATION_RULES: "Hành vi vi phạm và từ vựng",
        IDENTITY: "Định danh hành vi",
        HISTORY: "Lịch sử hiệu lực",
    };

    const STATUS_LABELS: Record<StageStatus, string> = {
        PENDING: "Chưa chạy",
        RUNNING: "Đang chạy",
        DONE: "Xong",
        FAILED: "Lỗi",
    };

    function statusVariant(status: StageStatus): "default" | "secondary" | "destructive" | "outline" {
        if (status === "DONE") {
            return "default";
        }

        if (status === "FAILED") {
            return "destructive";
        }

        return status === "RUNNING" ? "secondary" : "outline";
    }
</script>

<ol class="flex flex-col gap-2">
    {#each stages as item (item.stage)}
        <li class="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <span>{STAGE_LABELS[item.stage] ?? item.stage}</span>
                <Badge variant={statusVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
            </div>
            {#if item.error}
                <p class="text-xs break-words text-destructive">{item.error}</p>
            {/if}
        </li>
    {/each}
</ol>
