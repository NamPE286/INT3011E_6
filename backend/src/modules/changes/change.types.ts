import type { ProvisionLocator } from "./change.locator";

export const CHANGE_METHOD = "RULE_INSTRUCTION";
export const CHANGE_EXTRACTOR_VERSION = "change-instructions-v1";

/** FR-06 operations. SUBSTITUTE_TEXT is "thay/bỏ cụm từ …": wording is swapped inside the target. */
export type ChangeOperation = "AMEND" | "SUPPLEMENT" | "REPLACE" | "REPEAL" | "CORRECT" | "SUBSTITUTE_TEXT";

/** SRS §4.4 provision relation types used by resolved instructions. */
export type ProvisionRelationType = "AMENDS" | "SUPPLEMENTS" | "REPLACES" | "REPEALS" | "CORRECTS";

/** PROVISIONS: the instruction names Điều/Khoản/Điểm. DOCUMENT: it acts on a whole document. NONE: no target read. */
export type TargetScope = "PROVISIONS" | "DOCUMENT" | "NONE";

export type InstructionStatus = "RESOLVED" | "PARTIALLY_RESOLVED" | "CANDIDATE" | "UNRESOLVED" | "AMBIGUOUS" | "CONFLICT";

export type RelationVerification = "ACCEPTED" | "CANDIDATE";

/** What the extractor reads from one instruction provision, before the corpus is consulted. */
export type ChangeInstructionDraft = {
    id: string;
    sourceDocumentId: string;
    sourceProvisionId: string;
    sourceSnapshotId: string | null;
    operation: ChangeOperation;
    rawText: string;
    /** The address part of the instruction ("Sửa đổi, bổ sung điểm a khoản 5 Điều 5"). */
    rawTargetCitation: string;
    /** The document citation the target was read from ("Nghị định số 100/2019/NĐ-CP …"). */
    targetDocumentCitation: string | null;
    targetDocumentNumber: string | null;
    targetIsSelf: boolean;
    targetScope: TargetScope;
    targetLocators: ProvisionLocator[];
    newTextProvisionIds: string[];
    quotedSegments: string[];
    exceptions: string[];
};

export type ChangeInstruction = ChangeInstructionDraft & {
    targetDocumentId: string | null;
    effectiveFrom: string | null;
    resolutionStatus: InstructionStatus;
    resolutionReason: string;
};

export type ProvisionRelation = {
    id: string;
    changeInstructionId: string;
    fromDocumentId: string;
    fromProvisionId: string;
    toDocumentId: string;
    /** Null only for an insertion whose enclosing unit is the document itself ("Bổ sung Điều 6a"). */
    toProvisionId: string | null;
    relationType: ProvisionRelationType;
    targetLocator: ProvisionLocator;
    /** Where new text goes when it adds a provision that did not exist before. */
    insertionLocator: ProvisionLocator | null;
    newTextProvisionIds: string[];
    verificationStatus: RelationVerification;
    evidenceLevel: "EXPLICIT_LEGAL_TEXT";
    evidenceText: string;
    effectiveFrom: string | null;
    method: string;
    extractorVersion: string;
};
