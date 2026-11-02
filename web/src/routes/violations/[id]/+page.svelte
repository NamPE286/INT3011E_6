<script lang="ts">
    import type { ChangeEventView, LineageContext } from "$lib/api/violations";
    import { CHANGE_TYPE_LABELS } from "$lib/api/violations";
    import RuleCard from "$lib/components/RuleCard.svelte";
    import ScopeNotice from "$lib/components/ScopeNotice.svelte";
    import { Badge } from "$lib/components/ui/badge";
    import { Input } from "$lib/components/ui/input";
    import { describeChangeValue, formatDate, formatFineRange, formatPeriod, todayIso } from "$lib/format";
    import { documentTitleOf, provisionHref } from "$lib/labels";
    import { activeVersionDate, nextVersionDate, versionDates, versionStateAt, type VersionState } from "$lib/version-view";
    import { CalendarClock } from "@lucide/svelte";

    let { data } = $props();

    const SUBJECT_LABELS: Record<string, string> = { INDIVIDUAL: "cá nhân", ORGANIZATION: "tổ chức" };
    const FIELD_LABELS: Record<string, string> = { behavior_text: "Nội dung hành vi", fine: "Mức phạt", vehicles: "Phương tiện", subject: "Đối tượng", conditions: "Điều kiện", exceptions: "Ngoại lệ" };
    const END_LABELS: Record<string, string> = { AMENDED: "Đã bị sửa đổi", REPEALED: "Đã bị bãi bỏ", SUPERSEDED: "Đã bị thay thế" };

    const today = todayIso();
    const dates = $derived(versionDates(data.history.lineages));
    const hasAnyRule = $derived(data.rules.lineages.some((lineage) => lineage.applicable.length > 0 || lineage.uncertain.length > 0));
    const suggestedDate = $derived(hasAnyRule ? null : nextVersionDate(dates, data.asOf));
    const activeDate = $derived(data.asOf === today ? null : activeVersionDate(dates, data.asOf));
    const otherAliases = $derived(data.violation.aliases.filter((alias) => alias !== data.violation.canonicalName));

    function documentName(documentId: string): string {
        const known = data.corpus.find((entry) => entry.id === documentId);

        return known ? documentTitleOf(known) : documentId;
    }

    function describeContext(context: LineageContext): string {
        const parts = [...context.vehicles, context.subject ? (SUBJECT_LABELS[context.subject] ?? context.subject) : ""].filter((part) => part.length > 0);

        return parts.length > 0 ? parts.join(", ") : "Mọi phương tiện và đối tượng";
    }

    function asOfHref(date: string): string {
        return `?as_of=${date}`;
    }

    function stateLabel(state: VersionState): string {
        if (state.kind === "IN_FORCE") {
            return "Áp dụng tại ngày đang xem";
        }

        if (state.kind === "NOT_YET") {
            return "Chưa có hiệu lực tại ngày đang xem";
        }

        if (state.kind === "ENDED") {
            return END_LABELS[state.endType ?? ""] ?? "Đã hết hiệu lực";
        }

        return "Chưa rõ thời điểm có hiệu lực";
    }

    function changeInto(events: ChangeEventView[], ruleId: string): ChangeEventView | null {
        return events.find((event) => event.newRuleId === ruleId) ?? null;
    }

    function applyDate(event: Event): void {
        const input = event.currentTarget;

        if (input instanceof HTMLInputElement && input.value) {
            input.form?.requestSubmit();
        }
    }
</script>

<svelte:head>
    <title>{data.violation.canonicalName}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6">
    <nav aria-label="Đường dẫn">
        <a href="/violations" class="text-sm text-muted-foreground underline-offset-4 hover:underline">← Hành vi vi phạm</a>
    </nav>

    <header class="flex flex-col gap-2">
        <p class="text-sm font-medium tracking-wide text-accent-foreground uppercase">Hành vi vi phạm</p>
        <h1 class="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{data.violation.canonicalName}</h1>

        {#if otherAliases.length > 0}
            <p class="text-sm text-muted-foreground">Còn được diễn đạt: {otherAliases.join("; ")}</p>
        {/if}
    </header>

    <section aria-labelledby="as-of-heading" class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 id="as-of-heading" class="flex items-center gap-2 text-lg font-semibold">
                    <CalendarClock class="size-5 text-muted-foreground" aria-hidden="true" />
                    Quy định áp dụng ngày {formatDate(data.asOf)}
                </h2>

                <form method="GET" class="flex items-center gap-2">
                    <label for="as-of" class="text-sm text-muted-foreground">Chọn ngày</label>
                    <Input id="as-of" name="as_of" type="date" value={data.asOf} required onchange={applyDate} class="w-auto" />
                    <noscript><button type="submit" class="text-sm underline">Xem</button></noscript>
                </form>
            </div>

            <nav aria-label="Chọn nhanh ngày tra cứu" class="flex flex-wrap gap-2 text-sm">
                <a
                    href={asOfHref(today)}
                    aria-current={data.asOf === today ? "true" : undefined}
                    class="rounded-full border px-3 py-1 hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
                >
                    Hôm nay
                </a>
                {#each dates as date (date)}
                    <a
                        href={asOfHref(date)}
                        aria-current={activeDate === date ? "true" : undefined}
                        class="rounded-full border px-3 py-1 hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
                    >
                        Từ {formatDate(date)}
                    </a>
                {/each}
            </nav>
        </div>

        {#if !hasAnyRule}
            <div class="flex flex-col gap-3 rounded-2xl border border-dashed p-5" role="status">
                <p class="font-medium">Không có quy định nào áp dụng cho hành vi này vào ngày {formatDate(data.asOf)} trong dữ liệu đã nhập.</p>
                <p class="text-sm text-muted-foreground">Điều này không chứng minh hành vi không bị xử phạt: văn bản quy định có thể chưa được nhập.</p>
                {#if suggestedDate}
                    <a href={asOfHref(suggestedDate)} class="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                        Xem quy định có hiệu lực từ {formatDate(suggestedDate)}
                    </a>
                {/if}
            </div>
        {/if}

        {#if data.rules.lineages.length > 1}
            <p class="rounded-lg bg-accent/60 p-3 text-sm text-accent-foreground" role="note">
                Hành vi này có nhiều trường hợp theo phương tiện hoặc đối tượng; mỗi trường hợp được hiển thị riêng, không gộp lại.
            </p>
        {/if}

        {#each data.rules.lineages as lineage (lineage.lineageId)}
            {#if lineage.applicable.length > 0 || lineage.uncertain.length > 0}
                <div class="flex flex-col gap-3">
                    <h3 class="text-sm font-medium text-muted-foreground">Trường hợp: {describeContext(lineage)}</h3>

                    {#each [...lineage.applicable, ...lineage.uncertain] as rule (rule.ruleId)}
                        <RuleCard {rule} documentName={documentName(rule.sourceDocumentId)} />
                    {/each}
                </div>
            {/if}
        {/each}
    </section>

    <section aria-labelledby="history-heading" class="flex flex-col gap-4">
        <h2 id="history-heading" class="text-lg font-semibold">Lịch sử thay đổi</h2>

        {#if data.history.lineages.length === 0}
            <p class="text-sm text-muted-foreground" role="status">Chưa có lịch sử cho hành vi này.</p>
        {/if}

        {#each data.history.lineages as lineage (lineage.lineageId)}
            <div class="flex flex-col gap-3">
                {#if data.history.lineages.length > 1}
                    <h3 class="text-sm font-medium text-muted-foreground">Trường hợp: {describeContext(lineage)}</h3>
                {/if}

                <ol class="relative flex flex-col gap-4 border-l-2 border-border pl-6">
                    {#each lineage.rules as rule (rule.ruleId)}
                        {@const state = versionStateAt(rule, data.asOf)}
                        {@const change = changeInto(lineage.changeEvents, rule.ruleId)}
                        <li class="relative">
                            <span
                                class={`absolute top-5 -left-[33px] size-4 rounded-full border-2 border-background ${state.kind === "IN_FORCE" ? "bg-primary" : "bg-muted-foreground/40"}`}
                                aria-hidden="true"
                            ></span>

                            <div class={`flex flex-col gap-2 rounded-xl border p-4 ${state.kind === "IN_FORCE" ? "border-primary/40 bg-card shadow-sm" : "bg-card/60"}`}>
                                <div class="flex flex-wrap items-center gap-2 text-sm">
                                    <span class="font-medium">{formatPeriod(rule.validFrom, rule.validTo)}</span>
                                    <Badge variant={state.kind === "IN_FORCE" ? "default" : "secondary"}>{stateLabel(state)}</Badge>
                                </div>

                                <p class="text-lg font-semibold tabular-nums">{formatFineRange(rule.fine)}</p>

                                {#if change && change.changeTypes.length > 0}
                                    <div class="flex flex-col gap-1 text-sm">
                                        <div class="flex flex-wrap gap-1.5">
                                            {#each change.changeTypes as changeType (changeType)}
                                                <Badge variant="outline">{CHANGE_TYPE_LABELS[changeType]}</Badge>
                                            {/each}
                                        </div>
                                        {#each change.details as detail (detail.field)}
                                            <p class="text-muted-foreground">{FIELD_LABELS[detail.field] ?? detail.field}: {describeChangeValue(detail.before)} → {describeChangeValue(detail.after)}</p>
                                        {/each}
                                    </div>
                                {/if}

                                <p class="text-sm">
                                    <a href={provisionHref(rule.sourceDocumentId, rule.provisionId)} class="underline underline-offset-4">
                                        Điều khoản nguồn · {documentName(rule.sourceDocumentId)}
                                    </a>
                                    {#if state.kind !== "IN_FORCE" && rule.validFrom}
                                        · <a href={asOfHref(rule.validFrom)} class="text-muted-foreground underline underline-offset-4">Xem tại ngày này</a>
                                    {/if}
                                </p>
                            </div>
                        </li>
                    {/each}
                </ol>
            </div>
        {/each}
    </section>

    <ScopeNotice kind="rules" documentCount={data.history.scope.documentCount} frontier={data.history.scope.frontier} />
</main>
