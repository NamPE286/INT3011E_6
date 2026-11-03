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
    import { page } from "$app/state";
    import { Loader, Sparkles } from "@lucide/svelte";
    import type { PageProps } from "./$types";

    const MAX_QUESTION_LENGTH = 500;
    const STATUS_LABELS: Record<AnswerStatus, string> = {
        ANSWERED: "Có câu trả lời",
        AMBIGUOUS: "Cần thêm thông tin",
        UNCERTAIN: "Chưa thể khẳng định",
        NO_ANSWER: "Không đủ căn cứ để trả lời",
    };

    let { data }: PageProps = $props();

    const SAMPLE_QUESTIONS = [
        "Vượt đèn đỏ bị phạt bao nhiêu?",
        "Không đội mũ bảo hiểm khi đi xe máy bị phạt thế nào, trước đây ra sao?",
        "Đỗ xe trên phần đường xe chạy ngoài đô thị bị phạt bao nhiêu?",
    ];

    // A question passed from another page (?q=) only seeds the box.
    let question = $state((page.url.searchParams.get("q") ?? "").slice(0, MAX_QUESTION_LENGTH));
    // The default only seeds the select; later changes are the user's.
    // svelte-ignore state_referenced_locally
    let model = $state(data.modelOptions.defaultModel);
    let asOf = $state(todayIso());
    let loading = $state(false);
    let errorMessage = $state<string | null>(null);
    let answer = $state<AskAnswer | null>(null);

    function submitOnShortcut(event: KeyboardEvent): void {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && event.currentTarget instanceof HTMLTextAreaElement) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
        }
    }

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

<main class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6">
    <header class="flex flex-col gap-2">
        <p class="flex items-center gap-1.5 text-sm font-medium tracking-wide text-accent-foreground uppercase">
            <Sparkles class="size-4" aria-hidden="true" />
            Hỏi đáp AI
        </p>
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Hỏi về mức phạt bằng lời thường</h1>
        <p class="text-muted-foreground">
            Hệ thống tìm điều khoản liên quan trước rồi mới soạn câu trả lời. Mức phạt và hiệu lực chỉ được nêu khi có điều khoản nguồn đi kèm.
        </p>
    </header>

    <form onsubmit={submit} class="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div class="flex flex-col gap-1.5">
            <label for="question" class="sr-only">Câu hỏi</label>
            <Textarea
                id="question"
                bind:value={question}
                maxlength={MAX_QUESTION_LENGTH}
                rows={3}
                placeholder="Ví dụ: Vượt đèn đỏ bị phạt bao nhiêu?"
                required
                onkeydown={submitOnShortcut}
                class="resize-none border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0"
            />
        </div>

        <div class="flex flex-wrap gap-2 text-sm">
            {#each SAMPLE_QUESTIONS as sample (sample)}
                <button type="button" class="rounded-full border px-3 py-1 text-left hover:bg-muted" onclick={() => (question = sample)}>
                    {sample}
                </button>
            {/each}
        </div>

        <div class="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="flex flex-col gap-1.5">
                    <label for="as-of" class="text-sm font-medium">Áp dụng tại ngày</label>
                    <Input id="as-of" type="date" bind:value={asOf} required />
                </div>

                {#if data.modelOptions.models.length > 0}
                    <details class="text-sm">
                        <summary class="cursor-pointer py-2 text-muted-foreground">Tùy chọn mô hình</summary>
                        <div class="flex flex-col gap-1.5 pt-1">
                            <label for="model" class="font-medium">Mô hình</label>
                            <NativeSelect id="model" bind:value={model}>
                                {#each data.modelOptions.models as option (option.id)}
                                    <NativeSelectOption value={option.id}>{option.label}</NativeSelectOption>
                                {/each}
                            </NativeSelect>
                        </div>
                    </details>
                {/if}
            </div>

            <div class="flex items-center gap-3">
                <span class="hidden text-xs text-muted-foreground sm:inline">{question.length}/{MAX_QUESTION_LENGTH} · Ctrl + Enter để gửi</span>
                <Button type="submit" size="lg" disabled={loading || question.trim().length === 0}>
                    {#if loading}
                        <Loader class="animate-spin" aria-hidden="true" />
                        Đang tìm căn cứ…
                    {:else}
                        Hỏi
                    {/if}
                </Button>
            </div>
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
                            <li class="rounded-xl border border-l-4 border-l-primary bg-card p-4 text-sm leading-relaxed">
                                <p class="text-base">{claim.text}</p>
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
                                <li id={`evidence-${evidence.id}`} class="scroll-mt-24 rounded-lg border bg-card p-3 text-sm target:bg-accent/50">
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
