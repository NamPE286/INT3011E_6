<script lang="ts">
    import type { RuleCard } from "$lib/api/violations";
    import { RULE_STATUS_LABELS } from "$lib/api/violations";
    import { Badge } from "$lib/components/ui/badge";
    import { formatFineRange, formatPeriod } from "$lib/format";
    import { provisionHref } from "$lib/labels";

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
</script>

<article class="flex flex-col gap-3 rounded-2xl border p-4">
    <header class="flex flex-wrap items-center gap-2">
        <Badge variant={rule.status === "CURRENT" ? "default" : rule.status === "UNCERTAIN" ? "destructive" : "secondary"}>
            {RULE_STATUS_LABELS[rule.status]}
        </Badge>

        {#each rule.vehicles as vehicle (vehicle)}
            <Badge variant="outline">{vehicle}</Badge>
        {/each}

        {#if rule.subjectScope}
            <Badge variant="outline">{SUBJECT_LABELS[rule.subjectScope]}</Badge>
        {/if}
    </header>

    <p class="text-sm whitespace-pre-line">{rule.behaviorText}</p>

    <dl class="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt class="text-muted-foreground">Mức phạt tiền</dt>
        <dd class="font-medium">{formatFineRange(rule.fine)}</dd>

        {#if rule.warningAllowed}
            <dt class="text-muted-foreground">Cảnh cáo</dt>
            <dd>Có thể áp dụng</dd>
        {/if}

        {#if rule.effects.length > 0}
            <dt class="text-muted-foreground">Hình thức bổ sung</dt>
            <dd>
                <ul class="list-disc pl-4">
                    {#each rule.effects as effect (effect)}
                        <li>{effect}</li>
                    {/each}
                </ul>
            </dd>
        {/if}

        {#if pointText}
            <dt class="text-muted-foreground">Trừ điểm</dt>
            <dd>{pointText}</dd>
        {/if}

        {#if rule.remedialMeasures.length > 0}
            <dt class="text-muted-foreground">Biện pháp khắc phục</dt>
            <dd>
                <ul class="list-disc pl-4">
                    {#each rule.remedialMeasures as measure (measure)}
                        <li>{measure}</li>
                    {/each}
                </ul>
            </dd>
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

        <dt class="text-muted-foreground">Nguồn</dt>
        <dd>
            <a href={provisionHref(rule.sourceDocumentId, rule.provisionId)} class="underline underline-offset-4">
                {documentName}{rule.articleTitle ? ` — ${rule.articleTitle}` : ""}
            </a>
        </dd>
    </dl>

    {#if rule.reasons.length > 0}
        <div class="rounded-lg border border-dashed p-3 text-sm" role="note">
            <p class="font-medium">Cần lưu ý</p>
            <ul class="list-disc pl-4 text-muted-foreground">
                {#each rule.reasons as reason (reason)}
                    <li>{reason}</li>
                {/each}
            </ul>
        </div>
    {/if}
</article>
