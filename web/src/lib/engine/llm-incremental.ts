import { DEFAULT_GEMINI_MODEL } from "./gemini-client";
import { extractLegalFactsForUnits, type UserLlmExtractOptions } from "./llm-extract";
import type { WorkspaceContext } from "./local-workspace";
import { findNodeAtOffset, positionAtOffset, type ParsedDraft } from "./parser";
import type { NeuroSymbolicGroupCacheEntry } from "./llm-neurosymbolic";
import type { AiTokenBreakdown, ExtractedLegalFact, LegalDiagnostic } from "./types";

export type ExtractionUnit = {
    key: string;
    refLabel: string;
    text: string;
    startOffset: number;
    endOffset: number;
};

export type IncrementalExtractStats = {
    totalUnits: number;
    cachedUnits: number;
    sentUnits: number;
    actualAiTokens: number;
    tokenBreakdown?: AiTokenBreakdown;
};

const MAX_UNITS_PER_CALL = 12;

export function fnv1aHash(input: string): string {
    let hash = 0x811c9dc5;

    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeUnitText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/**
 * Splits a parsed draft into independent normative units (clauses, points, childless articles, or paragraphs)
 * keyed by a content hash so unchanged units are never re-sent to the LLM.
 */
export function extractUnitsFromDraft(draft: ParsedDraft): ExtractionUnit[] {
    const units: ExtractionUnit[] = [];
    const articlesWithChildren = new Set<string>();

    for (const node of draft.nodes) {
        if ((node.level === "CLAUSE" || node.level === "POINT") && node.parentId) {
            articlesWithChildren.add(node.parentId);
        }
    }

    for (const node of draft.nodes) {
        if (node.level === "CHAPTER") {
            continue;
        }

        if (node.level === "ARTICLE" && articlesWithChildren.has(node.id)) {
            continue;
        }

        const normalized = normalizeUnitText(node.text);

        if (normalized.length < 4) {
            continue;
        }

        units.push({
            key: fnv1aHash(normalized),
            refLabel: node.refLabel,
            text: normalized.slice(0, 280),
            startOffset: node.startOffset,
            endOffset: node.endOffset,
        });
    }

    if (units.length > 0) {
        return units;
    }

    const lines = draft.content.split("\n");
    let cursor = 0;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const normalized = normalizeUnitText(line);

        if (normalized.length >= 6) {
            units.push({
                key: fnv1aHash(normalized),
                refLabel: `Dòng ${i + 1}`,
                text: normalized.slice(0, 280),
                startOffset: cursor,
                endOffset: cursor + line.length,
            });
        }

        cursor += line.length + 1;
    }

    return units;
}

function buildCacheKey(model: string, workspaceContext: WorkspaceContext | undefined, unitKey: string): string {
    const termsDigest = workspaceContext
        ? fnv1aHash(workspaceContext.definedTerms.map((t) => t.normalizedTerm).sort().join("|"))
        : "00000000";

    return `${model}::${termsDigest}::${unitKey}`;
}

function reanchorFactsToUnit(
    cachedFacts: readonly ExtractedLegalFact[],
    draft: ParsedDraft,
    unit: ExtractionUnit,
): ExtractedLegalFact[] {
    const slice = draft.content.slice(unit.startOffset, unit.endOffset);
    const lowerSlice = slice.toLowerCase();
    const out: ExtractedLegalFact[] = [];

    for (const fact of cachedFacts) {
        let localIdx = slice.indexOf(fact.quote);

        if (localIdx === -1) {
            localIdx = lowerSlice.indexOf(fact.quote.toLowerCase());
        }

        if (localIdx === -1) {
            continue;
        }

        const startOffset = unit.startOffset + localIdx;
        const endOffset = startOffset + fact.quote.length;
        const line = positionAtOffset(draft.lineStarts, startOffset).line;
        const node = findNodeAtOffset(draft.nodes, startOffset);

        out.push({
            ...fact,
            startOffset,
            endOffset,
            line,
            provisionRef: node?.refLabel ?? unit.refLabel,
        });
    }

    return out;
}

export type SerializedIncrementalLlmCache = {
    version: 1;
    updatedAt: string;
    facts: [string, ExtractedLegalFact[]][];
    refDecisions: [string, LegalDiagnostic | null][];
    neuroSymbolic: [string, NeuroSymbolicGroupCacheEntry][];
};

export class IncrementalLlmCache {
    private readonly store = new Map<string, ExtractedLegalFact[]>();
    readonly refDecisionCache = new Map<string, LegalDiagnostic | null>();
    readonly neuroSymbolicCache = new Map<string, NeuroSymbolicGroupCacheEntry>();

    get size(): number {
        return this.store.size;
    }

    clear(): void {
        this.store.clear();
        this.refDecisionCache.clear();
        this.neuroSymbolicCache.clear();
    }

    toJSON(): SerializedIncrementalLlmCache {
        return {
            version: 1,
            updatedAt: new Date().toISOString(),
            facts: [...this.store.entries()],
            refDecisions: [...this.refDecisionCache.entries()],
            neuroSymbolic: [...this.neuroSymbolicCache.entries()],
        };
    }

    loadFromJSON(raw: unknown): boolean {
        if (typeof raw !== "object" || raw === null) {
            return false;
        }

        const rec = raw as Partial<SerializedIncrementalLlmCache>;

        if (rec.version !== 1) {
            return false;
        }

        this.clear();

        if (Array.isArray(rec.facts)) {
            for (const entry of rec.facts) {
                if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && Array.isArray(entry[1])) {
                    this.store.set(entry[0], entry[1]);
                }
            }
        }

        if (Array.isArray(rec.refDecisions)) {
            for (const entry of rec.refDecisions) {
                if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") {
                    this.refDecisionCache.set(entry[0], entry[1] ?? null);
                }
            }
        }

        if (Array.isArray(rec.neuroSymbolic)) {
            for (const entry of rec.neuroSymbolic) {
                if (
                    Array.isArray(entry)
                    && entry.length === 2
                    && typeof entry[0] === "string"
                    && typeof entry[1] === "object"
                    && entry[1] !== null
                ) {
                    this.neuroSymbolicCache.set(entry[0], entry[1]);
                }
            }
        }

        return true;
    }

    /**
     * Returns any already-cached facts for the current draft without triggering network calls.
     */
    getCachedFactsForDraft(
        draft: ParsedDraft,
        workspaceContext: WorkspaceContext | undefined,
        model = DEFAULT_GEMINI_MODEL,
    ): ExtractedLegalFact[] {
        const units = extractUnitsFromDraft(draft);
        const facts: ExtractedLegalFact[] = [];

        for (const unit of units) {
            const cached = this.store.get(buildCacheKey(model, workspaceContext, unit.key));

            if (cached && cached.length > 0) {
                facts.push(...reanchorFactsToUnit(cached, draft, unit));
            }
        }

        return facts;
    }

    /**
     * Incrementally extracts structured legal facts: only sends changed or newly added units to the LLM,
     * and reuses cached facts (re-anchored to current line/offsets) for unchanged units.
     */
    async extractIncrementally(
        draft: ParsedDraft,
        options: UserLlmExtractOptions,
    ): Promise<{
        facts: ExtractedLegalFact[];
        stats: IncrementalExtractStats;
        error: string | null;
    }> {
        const model = options.model?.trim() || DEFAULT_GEMINI_MODEL;
        const units = extractUnitsFromDraft(draft);
        const hitUnits: ExtractionUnit[] = [];
        const missUnits: ExtractionUnit[] = [];

        for (const unit of units) {
            const key = buildCacheKey(model, options.workspaceContext, unit.key);

            if (this.store.has(key)) {
                hitUnits.push(unit);
            } else {
                missUnits.push(unit);
            }
        }

        const mergedFacts: ExtractedLegalFact[] = [];

        for (const unit of hitUnits) {
            const cached = this.store.get(buildCacheKey(model, options.workspaceContext, unit.key)) ?? [];
            mergedFacts.push(...reanchorFactsToUnit(cached, draft, unit));
        }

        if (missUnits.length === 0) {
            return {
                facts: mergedFacts,
                stats: {
                    totalUnits: units.length,
                    cachedUnits: hitUnits.length,
                    sentUnits: 0,
                    actualAiTokens: 0,
                },
                error: null,
            };
        }

        const batchToSend = missUnits.slice(0, MAX_UNITS_PER_CALL);
        const extractResult = await extractLegalFactsForUnits(draft, batchToSend, options);

        if (extractResult.error === null) {
            for (const unit of batchToSend) {
                const unitFacts = extractResult.facts.filter(
                    (fact) => fact.startOffset >= unit.startOffset && fact.startOffset <= unit.endOffset,
                );
                this.store.set(buildCacheKey(model, options.workspaceContext, unit.key), unitFacts);
                mergedFacts.push(...unitFacts);
            }
        }

        return {
            facts: mergedFacts,
            stats: {
                totalUnits: units.length,
                cachedUnits: hitUnits.length,
                sentUnits: batchToSend.length,
                actualAiTokens: extractResult.actualAiTokens,
                tokenBreakdown: {
                    ...extractResult.tokenBreakdown,
                    cachedUnits: hitUnits.length,
                },
            },
            error: extractResult.error,
        };
    }
}
