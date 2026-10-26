import type { DurationUnit, FineRange, SanctionEffectType } from "./sanction.parser";

export const RULE_EXTRACTOR_VERSION = "violation-rules-v1";
export const SEMANTIC_PROMPT_VERSION = "violation-ir-v1";

export type PointDeductionApplicability = "APPLIES" | "NOT_APPLICABLE" | "UNKNOWN";

export type RuleExtractionStatus = "EXTRACTED" | "UNCERTAIN";

/** A behaviour-bearing provision placed at the address it governs (its own, or the one an amendment rewrites). */
export type RuleNode = {
    provisionId: string;
    sourceDocumentId: string;
    level: string;
    number: string;
    title: string | null;
    text: string;
    parentProvisionId: string | null;
    governedDocumentId: string;
    governedProvisionId: string;
    article: string | null;
    clause: string | null;
    point: string | null;
    articleTitle: string | null;
    isQuoted: boolean;
    readQuality: string | null;
};

export type RuleEffect = {
    effectType: SanctionEffectType;
    durationMin: number | null;
    durationMax: number | null;
    durationUnit: DurationUnit | null;
    points: number | null;
    rawText: string;
    sourceProvisionId: string;
};

export type RuleSanction = {
    fine: FineRange | null;
    warningAllowed: boolean;
    currency: "VND";
    pointDeductionApplicability: PointDeductionApplicability;
    pointsDeducted: number | null;
    effects: RuleEffect[];
    remedialMeasures: { text: string; sourceProvisionId: string }[];
    /** Provisions the sanction was read from: the fine clause, effect and remedial provisions. */
    evidenceProvisionIds: string[];
};

/** One semantic value with its source wording; `vocabId` is set only when it matches the registry. */
export type SemanticValue = {
    label: string;
    vocabId: string | null;
    evidence: string | null;
};

/** FR-08 dimensions. Values are null/empty when the provision does not state them. */
export type SemanticIr = {
    action: SemanticValue | null;
    polarity: "ACT" | "OMISSION" | null;
    subject: SemanticValue | null;
    vehicles: SemanticValue[];
    target: SemanticValue | null;
    location: SemanticValue | null;
    conditions: SemanticValue[];
    exceptions: SemanticValue[];
    consequence: SemanticValue | null;
};

export type ViolationRuleDraft = {
    id: string;
    sourceDocumentId: string;
    provisionId: string;
    governedDocumentId: string;
    governedProvisionId: string;
    sanctionProvisionId: string | null;
    behaviorText: string;
    articleTitle: string | null;
    subjectScope: FineRange["subject"];
    sanction: RuleSanction;
    semanticIr: SemanticIr;
    semanticMethod: "RULE" | "LLM";
    extractionStatus: RuleExtractionStatus;
    uncertaintyReasons: string[];
    effectiveFrom: string | null;
};
