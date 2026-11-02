<script lang="ts">
    import type { RuleCard } from "$lib/api/violations";
    import { RULE_STATUS_LABELS } from "$lib/api/violations";
    import { Badge } from "$lib/components/ui/badge";
    import { formatFineRange, formatPeriod } from "$lib/format";
    import { provisionHref } from "$lib/labels";
    import { FileText, TriangleAlert } from "@lucide/svelte";

    type Props = {
        rule: RuleCard;
        documentName: string;
    };

    let { rule, documentName }: Props = $props();

    const SUBJECT_LABELS = { INDIVIDUAL: "Cá nhân", ORGANIZATION: "Tổ chức" } as const;

    const pointText = $derived.by(() => {
        if (rule.pointDeductionApplicability === "APPLIES") {
            return rule.pointsDeducted === null ? "Có trừ điểm giấy phép lái xe" : `Trừ ${rule.pointsDeducted} điểm giấy phép lái xe`;
        }

        return null;
    });

    const isUncertain = $derived(rule.status === "UNCERTAIN");
</script>

<article class={`flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm ${isUncertain ? "border-destructive/40" : "border-primary/30"}`}>
    <header class="flex flex-wrap items-center gap-2">
        <Badge variant={rule.status === "CURRENT" ? "default" : isUncertain ? "destructive" : "secondary"}>
            {RULE_STATUS_LABELS[rule.status]}
        </Badge>

        {#each rule.vehicles as vehicle (vehicle)}
            <Badge variant="outline">{vehicle}</Badge>
        {/each}

        {#if rule.subjectScope}
            <Badge variant="outline">{SUBJECT_LABELS[rule.subjectScope]}</Badge>
        {/if}
    </header>

    <div class="flex flex-col gap-1">
        <p class="text-sm text-muted-foreground">Phạt tiền</p>
        <p class="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{formatFineRange(rule.fine)}</p>
        {#if rule.warningAllowed}
            <p class="text-sm text-muted-foreground">Có thể chỉ bị phạt cảnh cáo</p>
        {/if}
    </div>

    {#if rule.effects.length > 0 || pointText}
        <div class="flex flex-col gap-1.5">
            <p class="text-sm text-muted-foreground">Hình thức xử phạt bổ sung</p>
            <ul class="flex flex-wrap gap-2 text-sm">
                {#each rule.effects as effect (effect)}
                    <li class="rounded-lg bg-accent px-2.5 py-1 text-accent-foreground">{effect}</li>
                {/each}
                {#if pointText}
                    <li class="rounded-lg bg-accent px-2.5 py-1 text-accent-foreground">{pointText}</li>
                {/if}
            </ul>
        </div>
    {/if}

    <p class="text-sm whitespace-pre-line text-muted-foreground">{rule.behaviorText}</p>

    <dl class="grid gap-x-4 gap-y-1 border-t pt-3 text-sm sm:grid-cols-[9rem_1fr]">
        {#if rule.remedialMeasures.length > 0}
            <dt class="text-muted-foreground">Biện pháp khắc phục</dt>
            <dd>{rule.remedialMeasures.join("; ")}</dd>
        {/if}

        {#if rule.conditions.length > 0}
            <dt class="text-muted-foreground">Điều kiện</dt>
            <dd>{rule.conditions.join("; ")}</dd>
        {/if}

        {#if rule.exceptions.length > 0}
            <dt class="text-muted-foreground">Ngoại lệ</dt>
            <dd>{rule.exceptions.join("; ")}</dd>
        {/if}

        <dt class="text-muted-foreground">Hiệu lực</dt>
        <dd>{formatPeriod(rule.validFrom, rule.validTo)}</dd>

        <dt class="text-muted-foreground">Căn cứ</dt>
        <dd>
            <a href={provisionHref(rule.sourceDocumentId, rule.provisionId)} class="inline-flex items-center gap-1.5 font-medium underline underline-offset-4">
                <FileText class="size-4 shrink-0" aria-hidden="true" />
                {documentName}{rule.articleTitle ? ` — ${rule.articleTitle}` : ""}
            </a>
        </dd>
    </dl>

    {#if rule.reasons.length > 0}
        <div class="flex gap-2 rounded-lg border border-dashed border-destructive/40 p-3 text-sm" role="note">
            <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
                <p class="font-medium">Cần lưu ý</p>
                <ul class="list-disc pl-4 text-muted-foreground">
                    {#each rule.reasons as reason (reason)}
                        <li>{reason}</li>
                    {/each}
                </ul>
            </div>
        </div>
    {/if}
</article>
