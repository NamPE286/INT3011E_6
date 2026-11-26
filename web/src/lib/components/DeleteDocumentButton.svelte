<script lang="ts">
    import { goto } from "$app/navigation";
    import { deleteDocument } from "$lib/api/client";
    import type { DocumentDependents } from "$lib/api/documents";
    import * as AlertDialog from "$lib/components/ui/alert-dialog";
    import { Button } from "$lib/components/ui/button";
    import { documentTitleOf } from "$lib/labels";
    import { Trash2 } from "@lucide/svelte";

    type Props = {
        documentId: string;
        heading: string;
        dependents: DocumentDependents;
    };

    let { documentId, heading, dependents }: Props = $props();

    let open = $state(false);
    let deleting = $state(false);
    let errorMessage = $state<string | null>(null);

    const dependentNames = $derived(
        dependents.dependents.map((dependent) => documentTitleOf({ id: dependent.documentId, documentNumber: dependent.documentNumber, title: dependent.title })),
    );

    async function confirmDelete(): Promise<void> {
        deleting = true;
        errorMessage = null;

        try {
            await deleteDocument(fetch, documentId);
            open = false;
            await goto("/documents", { invalidateAll: true });
        } catch (cause: unknown) {
            errorMessage = cause instanceof Error ? cause.message : "Không thể xoá văn bản";
        } finally {
            deleting = false;
        }
    }
</script>

{#if dependents.deletable}
    <AlertDialog.Root bind:open>
        <AlertDialog.Trigger>
            {#snippet child({ props })}
                <Button {...props} variant="outline" size="sm" class="text-destructive hover:text-destructive">
                    <Trash2 class="size-4" aria-hidden="true" />
                    Xoá văn bản
                </Button>
            {/snippet}
        </AlertDialog.Trigger>

        <AlertDialog.Content>
            <AlertDialog.Header>
                <AlertDialog.Title>Xoá {heading}?</AlertDialog.Title>
                <AlertDialog.Description>
                    Văn bản, các điều khoản, quan hệ tới văn bản khác, hành vi và mức phạt đọc từ văn bản này cùng tệp PDF đã tải lên sẽ bị xoá. Không thể hoàn tác.
                </AlertDialog.Description>
            </AlertDialog.Header>

            {#if errorMessage}
                <p class="text-sm text-destructive" role="alert">{errorMessage}</p>
            {/if}

            <AlertDialog.Footer>
                <AlertDialog.Cancel disabled={deleting}>Huỷ</AlertDialog.Cancel>
                <Button variant="destructive" disabled={deleting} onclick={confirmDelete}>
                    {deleting ? "Đang xoá…" : "Xoá văn bản"}
                </Button>
            </AlertDialog.Footer>
        </AlertDialog.Content>
    </AlertDialog.Root>
{:else}
    <div class="flex flex-col gap-1">
        <Button variant="outline" size="sm" disabled aria-describedby="delete-blocked">
            <Trash2 class="size-4" aria-hidden="true" />
            Xoá văn bản
        </Button>
        <p id="delete-blocked" class="max-w-xs text-xs text-muted-foreground">
            Chỉ xoá được văn bản không bị văn bản khác tác động. Đang bị tác động bởi: {dependentNames.join(", ")}.
        </p>
    </div>
{/if}
