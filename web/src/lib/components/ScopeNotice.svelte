<script lang="ts">
    import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
    import { Info } from "@lucide/svelte";

    type Kind = "documents" | "document" | "graph" | "rules";

    type Props = {
        kind: Kind;
        documentCount?: number | null;
        frontier?: string[];
    };

    const DISCLAIMERS: Record<Kind, string> = {
        documents: "Kết quả chỉ gồm văn bản đã nhập vào hệ thống. Không tìm thấy không chứng minh văn bản không tồn tại.",
        document: "Phần bị sửa đổi, thay thế hoặc bãi bỏ chỉ được đánh dấu khi văn bản tác động đã được nhập. Phần không có nhãn chưa chắc còn nguyên hiệu lực.",
        graph: "Lược đồ chỉ được dựng từ các văn bản đã nhập. Dẫn chiếu chưa xác minh không phải quan hệ pháp lý, và danh sách trống không chứng minh rằng không có quan hệ.",
        rules: "Kết quả chỉ tính trên các văn bản đã nhập. Quy định chưa ghi nhận việc sửa đổi vẫn có thể đã bị thay đổi bởi văn bản chưa nhập.",
    };

    let { kind, documentCount = null, frontier = [] }: Props = $props();
</script>

<Alert>
    <Info aria-hidden="true" />
    <AlertTitle>Phạm vi dữ liệu</AlertTitle>
    <AlertDescription>
        {#if documentCount !== null}
            <p>Dữ liệu hiện có {documentCount} văn bản đã nhập.</p>
        {/if}

        <p>{DISCLAIMERS[kind]}</p>

        {#if frontier.length > 0}
            <p>
                Văn bản được dẫn chiếu nhưng chưa nhập vào hệ thống: {frontier.join(", ")}.
            </p>
        {/if}
    </AlertDescription>
</Alert>
