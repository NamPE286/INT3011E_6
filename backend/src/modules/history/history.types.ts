export const HISTORY_VERSION = "rule-history-v1";

/** FR-12 rule status at a point in time. NOT_YET_EFFECTIVE marks a rule whose document is not in force yet. */
export type RuleStatus = "CURRENT" | "AMENDED" | "REPEALED" | "SUPERSEDED" | "UNCERTAIN" | "NOT_YET_EFFECTIVE";

export type EndType = "AMENDED" | "REPEALED" | "SUPERSEDED";

/** The legal evidence that ended a rule's interval or links it to the next rule of its lineage. */
export type IntervalEvidence = {
    kind: "PROVISION_RELATION" | "DOCUMENT_RELATION";
    relationId: string;
    relationType: string;
    fromDocumentId: string;
    effectiveFrom: string | null;
};

/** Why a rule's state at some date cannot be stated with certainty. */
export type IntervalWarning = {
    code: "EFFECTIVE_DATE_UNKNOWN" | "END_DATE_UNKNOWN" | "UNVERIFIED_RELATION" | "UNRESOLVED_INSTRUCTION" | "OPEN_DOCUMENT_CANDIDATE";
    message: string;
    effectiveFrom: string | null;
};

export type RuleInterval = {
    ruleId: string;
    lineageId: string;
    validFrom: string | null;
    validTo: string | null;
    endType: EndType | null;
    endEvidence: IntervalEvidence | null;
    successorRuleId: string | null;
    warnings: IntervalWarning[];
};

export type LineageLink = "PROVISION_RELATION" | "DOCUMENT_REPLACEMENT";

export type RuleLineage = {
    id: string;
    trafficViolationId: string;
    lineageKey: string;
    contextIr: { vehicles: string[]; subject: string | null; subjectScope: string | null };
    ruleIds: string[];
    links: { fromRuleId: string; toRuleId: string; link: LineageLink; evidenceId: string }[];
};
