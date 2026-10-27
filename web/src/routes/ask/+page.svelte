<script lang="ts">
    import { askQuestion } from "$lib/api/client";
    import type { AnswerStatus, AskAnswer } from "$lib/api/ask";
    import { ApiError } from "$lib/api/http";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Alert, AlertDescription, AlertTitle } from "$lib/components/ui/alert";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Textarea } from "$lib/components/ui/textarea";
    import { formatDate, formatFineRange, formatPeriod, todayIso } from "$lib/format";
    import { provisionHref } from "$lib/labels";
    import { NativeSelect, NativeSelectOption } from "$lib/components/ui/native-select";
    import { Loader } from "@lucide/svelte";
    import type { PageProps } from "./$types";

    const MAX_QUESTION_LENGTH = 500;
    const STATUS_LABELS: Record<AnswerStatus, string> = {
        ANSWERED: "Có câu trả lời",
        AMBIGUOUS: "Cần thêm thông tin",
        UNCERTAIN: "Chưa thể khẳng định",
        NO_ANSWER: "Không đủ căn cứ để trả lời",
    };

    let { data }: PageProps = $props();

    let question = $state("");
    // The default only seeds the select; later changes are the user's.
    // svelte-ignore state_referenced_locally
    let model = $state(data.modelOptions.defaultModel);
    let asOf = $state(todayIso());
    let loading = $state(false);
    let errorMessage = $state<string | null>(null);
    let answer = $state<AskAnswer | null>(null);

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();

        if (loading || question.trim().length === 0) {
            return;
        }

        loading = true;
        errorMessage = null;

        try {
            answer = await askQuestion(question.trim(), asOf, model);
        } catch (cause: unknown) {
            answer = null;
            errorMessage = cause instanceof ApiError ? cause.message : "Không thể gửi câu hỏi";
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Hỏi đáp AI</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
    <header>
        <h1 class="text-2xl font-semibold tracking-tight">Hỏi đáp về xử phạt giao thông</h1>
        <p class="text-sm text-muted-foreground">
            Hệ thống tìm điều khoản liên quan trước, rồi mới soạn câu trả lời. Mức phạt và hiệu lực chỉ được nêu khi có điều khoản nguồn đi kèm.
        </p>
    </header>

    <form onsubmit={submit} class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
            <label for="question" class="text-sm font-medium">Câu hỏi</label>
            <Textarea
                id="question"
                bind:value={question}
                maxlength={MAX_QUESTION_LENGTH}
                rows={3}
                placeholder="Ví dụ: Không chấp hành hiệu lệnh của đèn tín hiệu giao thông bị phạt bao nhiêu?"
                required
            />
            <p class="text-xs text-muted-foreground">{question.length}/{MAX_QUESTION_LENGTH} ký tự</p>
        </div>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="flex flex-col gap-1.5">
                <label for="as-of" class="text-sm font-medium">Áp dụng tại ngày</label>
                <Input id="as-of" type="date" bind:value={asOf} required />
            </div>

            {#if data.modelOptions.models.length > 0}
                <div class="flex flex-col gap-1.5">
                    <label for="model" class="text-sm font-medium">Mô hình</label>
                    <NativeSelect id="model" bind:value={model}>
                        {#each data.modelOptions.models as option (option.id)}
                            <NativeSelectOption value={option.id}>{option.label}</NativeSelectOption>
                        {/each}
                    </NativeSelect>
                </div>
            {/if}

            <Button type="submit" disabled={loading || question.trim().length === 0}>
                {#if loading}
                    <Loader class="animate-spin" aria-hidden="true" />
                    Đang tìm căn cứ…
                {:else}
                    Hỏi
                {/if}
            </Button>
        </div>
    </form>

    <div aria-live="polite" class="flex flex-col gap-4">
        {#if errorMessage}
            <Alert variant="destructive">
                <AlertTitle>Không lấy được câu trả lời</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
        {/if}

        {#if answer}
            <section aria-labelledby="answer-heading" class="flex flex-col gap-4">
                <div class="flex flex-wrap items-center gap-2">
                    <h2 id="answer-heading" class="text-lg font-semibold">Câu trả lời tại {formatDate(answer.asOf)}</h2>
                    <Badge variant={answer.status === "ANSWERED" ? "default" : "outline"}>{STATUS_LABELS[answer.status]}</Badge>
                </div>

                {#if answer.status === "NO_ANSWER"}
                    <p class="text-sm" role="status">
                        Không tìm thấy quy định phù hợp với câu hỏi trong dữ liệu đã xử lý tại ngày này. Hệ thống không đưa ra kết luận pháp lý khi không có điều khoản nguồn.
                    </p>
                {/if}

                {#if answer.clarification}
                    <Alert>
                        <AlertTitle>Cần làm rõ</AlertTitle>
                        <AlertDescription>{answer.clarification}</AlertDescription>
                    </Alert>
                {/if}

                {#if answer.claims.length > 0}
                    <ul class="flex flex-col gap-3">
                        {#each answer.claims as claim (claim.text)}
                            <li class="rounded-lg border p-3 text-sm">
                                <p>{claim.text}</p>
                                <p class="mt-1 text-xs text-muted-foreground">
                                    Nguồn:
                                    {#each claim.evidenceIds as evidenceId, index (evidenceId)}
                                        <a href={`#evidence-${evidenceId}`} class="underline underline-offset-4">[{evidenceId}]</a>{index < claim.evidenceIds.length - 1 ? ", " : ""}
                                    {/each}
                                </p>
                            </li>
                        {/each}
                    </ul>
                {/if}

                {#if answer.evidence.length > 0}
                    <div class="flex flex-col gap-2">
                        <h3 class="text-base font-medium">Điều khoản nguồn</h3>

                        <ul class="flex flex-col gap-2">
                            {#each answer.evidence as evidence (evidence.id)}
                                <li id={`evidence-${evidence.id}`} class="scroll-mt-20 rounded-lg border p-3 text-sm target:bg-muted/60">
                                    <p class="font-medium">[{evidence.id}] {evidence.violationName}</p>
                                    <p class="text-muted-foreground">
                                        {formatFineRange(evidence.fine)} · {formatPeriod(evidence.validFrom, evidence.validTo)}
                                    </p>
                                    <a href={provisionHref(evidence.source.documentId, evidence.source.provisionId)} class="underline underline-offset-4">
                                        Mở điều khoản nguồn{evidence.source.documentNumber ? ` (${evidence.source.documentNumber})` : ""}
                                    </a>
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}

                <p class="text-xs text-muted-foreground">
                    {#if answer.provenance.method === "LLM"}
                        Câu trả lời được soạn bằng mô hình {answer.provenance.model}; chỉ các nhận định có nguồn hợp lệ được giữ lại{answer.provenance.droppedClaims > 0 ? ` (đã loại ${answer.provenance.droppedClaims} nhận định không có căn cứ)` : ""}.
                    {:else}
                        Câu trả lời được lập trực tiếp từ điều khoản đã lưu, không qua mô hình.{answer.provenance.fallbackReason ? " Mô hình không đưa ra nhận định hợp lệ, nên hệ thống dùng câu trả lời lập từ điều khoản." : ""}
                    {/if}
                </p>

                <ScopeNotice kind="rules" documentCount={answer.scope.documentCount} frontier={answer.scope.frontier} />
            </section>
        {/if}
    </div>
</main>
