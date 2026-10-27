<script lang="ts">
    import type { LineageContext, RuleCard as RuleCardData } from "$lib/api/violations";
    import { CHANGE_TYPE_LABELS, RULE_STATUS_LABELS } from "$lib/api/violations";
    import RuleCard from "$lib/components/RuleCard.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { describeChangeValue, formatDate, formatFineRange, formatPeriod } from "$lib/format";
    import { documentTitleOf, provisionHref } from "$lib/labels";

    let { data } = $props();

    const SUBJECT_LABELS: Record<string, string> = { INDIVIDUAL: "cá nhân", ORGANIZATION: "tổ chức" };
    const FIELD_LABELS: Record<string, string> = { behavior_text: "Nội dung hành vi", fine: "Mức phạt", vehicles: "Phương tiện", subject: "Đối tượng", conditions: "Điều kiện", exceptions: "Ngoại lệ" };

    const hasMultipleCases = $derived(data.rules.lineages.length > 1);

    function documentName(documentId: string): string {
        const known = data.corpus.find((entry) => entry.id === documentId);

        return known ? documentTitleOf(known) : documentId;
    }

    function describeContext(context: LineageContext): string {
        const parts = [...context.vehicles, context.subject ? (SUBJECT_LABELS[context.subject] ?? context.subject) : ""].filter((part) => part.length > 0);

        return parts.length > 0 ? parts.join(", ") : "Không giới hạn phương tiện hoặc đối tượng";
    }

    function newProvisionHref(rules: RuleCardData[], ruleId: string | null): string | null {
        const rule = rules.find((candidate) => candidate.ruleId === ruleId);

        return rule ? provisionHref(rule.sourceDocumentId, rule.provisionId) : null;
    }
</script>

<svelte:head>
    <title>{data.violation.canonicalName}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
    <nav aria-label="Đường dẫn">
        <a href="/violations" class="text-sm text-muted-foreground underline underline-offset-4">← Hành vi vi phạm</a>
    </nav>

    <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight">{data.violation.canonicalName}</h1>

        {#if data.violation.aliases.length > 1}
            <p class="text-sm text-muted-foreground">Còn được diễn đạt: {data.violation.aliases.filter((alias) => alias !== data.violation.canonicalName).join("; ")}</p>
        {/if}
    </header>

    <section aria-labelledby="as-of-heading" class="flex flex-col gap-4">
        <h2 id="as-of-heading" class="text-lg font-semibold">Quy định áp dụng tại {formatDate(data.asOf)}</h2>

        <form method="GET" class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="flex flex-col gap-1.5">
                <label for="as-of" class="text-sm font-medium">Xem tại ngày</label>
                <Input id="as-of" name="as_of" type="date" value={data.asOf} required />
            </div>
            <Button type="submit" variant="secondary">Xem</Button>
        </form>

        {#if data.rules.lineages.length === 0}
            <p class="text-sm text-muted-foreground" role="status">
                Dữ liệu không ghi nhận quy định nào cho hành vi này tại ngày đã chọn. Điều này không chứng minh rằng hành vi không bị xử phạt.
            </p>
        {/if}

        {#if hasMultipleCases}
            <p class="rounded-lg border border-dashed p-3 text-sm" role="note">
                Hành vi này có nhiều trường hợp áp dụng khác nhau theo phương tiện hoặc đối tượng. Từng trường hợp được hiển thị riêng, không gộp lại.
            </p>
        {/if}

        {#each data.rules.lineages as lineage (lineage.lineageId)}
            <div class="flex flex-col gap-3">
                <h3 class="text-base font-medium">{describeContext(lineage)}</h3>

                {#each lineage.applicable as rule (rule.ruleId)}
                    <RuleCard {rule} documentName={documentName(rule.sourceDocumentId)} />
                {/each}

                {#each lineage.uncertain as rule (rule.ruleId)}
                    <RuleCard {rule} documentName={documentName(rule.sourceDocumentId)} />
                {/each}

                {#if lineage.applicable.length === 0 && lineage.uncertain.length === 0}
                    <p class="text-sm text-muted-foreground" role="status">Không có quy định áp dụng cho trường hợp này tại ngày đã chọn.</p>
                {/if}
            </div>
        {/each}

        <ScopeNotice kind="rules" documentCount={data.rules.scope.documentCount} frontier={data.rules.scope.frontier} />
    </section>

    <section aria-labelledby="history-heading" class="flex flex-col gap-4">
        <h2 id="history-heading" class="text-lg font-semibold">Lịch sử thay đổi</h2>

        {#if data.history.lineages.length === 0}
            <p class="text-sm text-muted-foreground" role="status">Chưa có lịch sử cho hành vi này.</p>
        {/if}

        {#each data.history.lineages as lineage (lineage.lineageId)}
            <div class="flex flex-col gap-3">
                <h3 class="text-base font-medium">{describeContext(lineage)}</h3>

                <ol class="flex flex-col gap-3 border-l pl-4">
                    {#each lineage.rules as rule (rule.ruleId)}
                        <li class="flex flex-col gap-1 text-sm">
                            <div class="flex flex-wrap items-center gap-2">
                                <Badge variant={rule.status === "CURRENT" ? "default" : "secondary"}>{RULE_STATUS_LABELS[rule.status]}</Badge>
                                <span>{formatPeriod(rule.validFrom, rule.validTo)}</span>
                            </div>
                            <p>
                                Mức phạt: <span class="font-medium">{formatFineRange(rule.fine)}</span>
                                ·
                                <a href={provisionHref(rule.sourceDocumentId, rule.provisionId)} class="underline underline-offset-4">{documentName(rule.sourceDocumentId)}</a>
                            </p>
                        </li>
                    {/each}
                </ol>

                {#if lineage.changeEvents.length > 0}
                    <div class="flex flex-col gap-2">
                        <h4 class="text-sm font-medium">Thay đổi giữa các phiên bản</h4>

                        <ul class="flex flex-col gap-2">
                            {#each lineage.changeEvents as event (event.id)}
                                <li class="rounded-lg border p-3 text-sm">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="font-medium">{formatDate(event.effectiveAt)}</span>
                                        {#each event.changeTypes as changeType (changeType)}
                                            <Badge variant={changeType === "UNKNOWN" ? "outline" : "secondary"}>{CHANGE_TYPE_LABELS[changeType]}</Badge>
                                        {/each}
                                    </div>

                                    {#if event.details.length > 0}
                                        <ul class="mt-1 list-disc pl-4 text-muted-foreground">
                                            {#each event.details as detail (detail.field)}
                                                <li>{FIELD_LABELS[detail.field] ?? detail.field}: {describeChangeValue(detail.before)} → {describeChangeValue(detail.after)}</li>
                                            {/each}
                                        </ul>
                                    {/if}

                                    {#if event.evidenceDocumentId}
                                        <p class="mt-1 text-xs">
                                            Căn cứ: <a href={`/documents/${encodeURIComponent(event.evidenceDocumentId)}`} class="underline underline-offset-4">{documentName(event.evidenceDocumentId)}</a>
                                            {#if newProvisionHref(lineage.rules, event.newRuleId)}
                                                ·
                                                <a href={newProvisionHref(lineage.rules, event.newRuleId)} class="underline underline-offset-4">Điều khoản mới</a>
                                            {/if}
                                        </p>
                                    {/if}
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            </div>
        {/each}

        <ScopeNotice kind="rules" documentCount={data.history.scope.documentCount} frontier={data.history.scope.frontier} />
    </section>
</main>
