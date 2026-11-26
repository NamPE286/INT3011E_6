import type { AmendmentType, Provision } from "./api/documents";

export const AMENDMENT_LABELS: Record<AmendmentType, string> = {
    AMENDS: "Bị sửa đổi",
    SUPPLEMENTS: "Được bổ sung",
    REPLACES: "Bị thay thế",
    REPEALS: "Bị bãi bỏ",
    CORRECTS: "Được đính chính",
};

type RelationLabel = {
    /** This document acts on the other one. */
    outgoing: string;
    /** The other document acts on this one. */
    incoming: string;
};

export const RELATION_LABELS: Record<string, RelationLabel> = {
    AMENDS: { outgoing: "Sửa đổi", incoming: "Bị sửa đổi bởi" },
    SUPPLEMENTS: { outgoing: "Bổ sung", incoming: "Được bổ sung bởi" },
    AMENDS_OR_SUPPLEMENTS: { outgoing: "Sửa đổi, bổ sung", incoming: "Bị sửa đổi, bổ sung bởi" },
    REPLACES: { outgoing: "Thay thế", incoming: "Bị thay thế bởi" },
    REPEALS: { outgoing: "Bãi bỏ", incoming: "Bị bãi bỏ bởi" },
    PARTIALLY_REPLACES: { outgoing: "Thay thế một phần", incoming: "Bị thay thế một phần bởi" },
    FULLY_REPLACES: { outgoing: "Thay thế toàn bộ", incoming: "Bị thay thế toàn bộ bởi" },
    PARTIALLY_REPEALS: { outgoing: "Bãi bỏ một phần", incoming: "Bị bãi bỏ một phần bởi" },
    FULLY_REPEALS: { outgoing: "Bãi bỏ toàn bộ", incoming: "Bị bãi bỏ toàn bộ bởi" },
    CORRECTS: { outgoing: "Đính chính", incoming: "Được đính chính bởi" },
    REFERENCES: { outgoing: "Dẫn chiếu tới", incoming: "Được dẫn chiếu bởi" },
    LEGAL_BASIS: { outgoing: "Căn cứ vào", incoming: "Là căn cứ của" },
    GUIDES: { outgoing: "Hướng dẫn thi hành", incoming: "Được hướng dẫn bởi" },
    DETAILS: { outgoing: "Quy định chi tiết", incoming: "Được quy định chi tiết bởi" },
    EXPLAINS: { outgoing: "Giải thích", incoming: "Được giải thích bởi" },
    SUSPENDS: { outgoing: "Tạm ngưng hiệu lực", incoming: "Bị tạm ngưng hiệu lực bởi" },
    EXTENDS_EFFECT: { outgoing: "Kéo dài hiệu lực", incoming: "Được kéo dài hiệu lực bởi" },
    RESUMES_EFFECT: { outgoing: "Cho hiệu lực trở lại", incoming: "Được cho hiệu lực trở lại bởi" },
    CONTINUES_APPLICATION: { outgoing: "Tiếp tục áp dụng", incoming: "Được tiếp tục áp dụng bởi" },
    CONSOLIDATES: { outgoing: "Hợp nhất", incoming: "Được hợp nhất bởi" },
    UNKNOWN: { outgoing: "Quan hệ chưa xác định tới", incoming: "Quan hệ chưa xác định từ" },
};

export const RELATION_SCOPE_LABELS: Record<string, string> = {
    FULL: "Toàn bộ văn bản",
    PARTIAL: "Một phần văn bản",
    UNKNOWN: "Chưa rõ phạm vi",
};

export const CANDIDATE_STATUS_LABELS: Record<string, string> = {
    CANDIDATE: "Ứng viên, chưa xác minh",
    UNRESOLVED: "Chưa có văn bản trong dữ liệu",
    AMBIGUOUS: "Nhiều văn bản trùng số hiệu",
    CONFLICT: "Mâu thuẫn thông tin",
    ACCEPTED: "Đã xác minh",
    REJECTED: "Đã loại",
};

export const SANCTION_CHANGE_LABELS: Record<string, string> = {
    SANCTION_INCREASE: "Tăng nặng xử phạt",
    SANCTION_DECREASE: "Giảm nhẹ xử phạt",
    POINT_DEDUCTION_CHANGED: "Thay đổi trừ điểm GPLX",
    POINT_DEDUCTION_APPLICABILITY_CHANGED: "Bổ sung/Bỏ trừ điểm GPLX",
    LICENSE_SUSPENSION_CHANGED: "Thay đổi tước GPLX",
    VEHICLE_CONFISCATION_CHANGED: "Thay đổi tịch thu phương tiện",
    SANCTION_CHANGED: "Thay đổi mức xử lý",
    VIOLATION_ADDED: "Bổ sung hành vi xử phạt",
    ADDITIONAL_SANCTION_CHANGED: "Thay đổi hình phạt bổ sung",
    REPEALED: "Bãi bỏ xử phạt",
};

export function sanctionChangeLabel(changeType: string): string {
    return SANCTION_CHANGE_LABELS[changeType] ?? changeType;
}

export function relationLabel(type: string, direction: "OUTGOING" | "INCOMING"): string {
    if (SANCTION_CHANGE_LABELS[type]) {
        return SANCTION_CHANGE_LABELS[type];
    }

    const labels = RELATION_LABELS[type] ?? RELATION_LABELS.UNKNOWN;

    return direction === "OUTGOING" ? labels.outgoing : labels.incoming;
}

const LEVEL_NAMES: Partial<Record<string, string>> = {
    PART: "Phần",
    CHAPTER: "Chương",
    SECTION: "Mục",
    ARTICLE: "Điều",
};

/** "Điều 5", "Chương II", "5." for a clause or "a)" for a point, as the source text writes them. */
export function provisionLabel(provision: Pick<Provision, "level" | "number">): string {
    if (provision.level === "PREAMBLE") {
        return "Căn cứ";
    }

    if (provision.level === "CLAUSE") {
        return `${provision.number}.`;
    }

    if (provision.level === "POINT") {
        return `${provision.number})`;
    }

    return `${LEVEL_NAMES[provision.level] ?? provision.level} ${provision.number}`.trim();
}

/** Link to a provision inside its document; the fragment matches the id on the rendered provision. */
export function provisionHref(documentId: string, provisionId: string): string {
    return `/documents/${encodeURIComponent(documentId)}#${encodeURIComponent(provisionId)}`;
}

export function documentTitleOf(document: { documentNumber: string | null; title: string | null; id: string }): string {
    return document.documentNumber ?? document.title ?? document.id;
}

const VEHICLE_TAIL = /\s*\(|,?\s+(?:và\s+)?các loại xe tương tự/u;

/**
 * The vehicle as people say it: "xe mô tô, xe gắn máy (kể cả xe máy điện), các loại xe tương tự …" reads
 * "Xe mô tô, xe gắn máy". The full wording stays available to show on demand.
 */
export function shortVehicle(vehicle: string): string {
    const head = vehicle.split(VEHICLE_TAIL, 1)[0].trim();

    return capitalize(head.length > 0 ? head : vehicle.trim());
}

/** The violating subject as written in the rule ("người điều khiển xe ô tô"), or null when the rule names none. */
export function subjectLabel(subject: string | null): string | null {
    const trimmed = subject?.trim() ?? "";

    return trimmed.length > 0 ? capitalize(trimmed) : null;
}

function capitalize(text: string): string {
    return text.charAt(0).toLocaleUpperCase("vi") + text.slice(1);
}
