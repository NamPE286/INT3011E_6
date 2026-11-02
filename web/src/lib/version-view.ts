import type { RuleCard } from "./api/violations";

type RulePeriod = Pick<RuleCard, "validFrom" | "validTo" | "endType">;

export type VersionState = { kind: "IN_FORCE" } | { kind: "NOT_YET" } | { kind: "ENDED"; endType: string | null } | { kind: "UNKNOWN" };

/** Every date a version of the behaviour starts, oldest first: the dates worth looking the rule up at. */
export function versionDates(lineages: readonly { rules: readonly RulePeriod[] }[]): string[] {
    const dates = new Set<string>();

    for (const lineage of lineages) {
        for (const rule of lineage.rules) {
            if (rule.validFrom) {
                dates.add(rule.validFrom);
            }
        }
    }

    return [...dates].sort();
}

/** Where one version stands on the date being viewed, rather than today. */
export function versionStateAt(rule: RulePeriod, asOf: string): VersionState {
    if (!rule.validFrom) {
        return { kind: "UNKNOWN" };
    }

    if (asOf < rule.validFrom) {
        return { kind: "NOT_YET" };
    }

    if (rule.validTo && asOf >= rule.validTo) {
        return { kind: "ENDED", endType: rule.endType };
    }

    return { kind: "IN_FORCE" };
}

/** The date to suggest when nothing applies on the viewed date: the next version after it, else the latest one. */
export function nextVersionDate(dates: readonly string[], asOf: string): string | null {
    const later = dates.find((date) => date > asOf);

    if (later) {
        return later;
    }

    return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** The start of the version in force on the date, so the matching quick pick can be shown as selected. */
export function activeVersionDate(dates: readonly string[], asOf: string): string | null {
    const started = dates.filter((date) => date <= asOf);

    return started.length > 0 ? started[started.length - 1] : null;
}
