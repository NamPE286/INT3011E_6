const REASON_TEXTS: Record<string, string> = {
    NO_FINE: "Chưa đọc được mức phạt từ văn bản",
    MULTIPLE_FINE_RANGES: "Có nhiều mức phạt nhưng không phân biệt được đối tượng",
    LOW_READ_QUALITY: "Chất lượng đọc văn bản thấp",
    CONFLICTING_SUSPENSIONS: "Các hình thức tước giấy phép lái xe mâu thuẫn nhau",
    CONFLICTING_POINT_DEDUCTIONS: "Số điểm bị trừ mâu thuẫn nhau",
    SEMANTIC_NOT_RETURNED: "Chưa phân tích được nội dung hành vi",
    MODEL_NOT_A_VIOLATION: "Nội dung này có thể không phải hành vi vi phạm",
    NO_ACTION: "Chưa xác định được hành vi",
    EFFECTIVE_DATE_UNKNOWN: "Chưa đọc được ngày có hiệu lực của văn bản chứa quy định",
    END_DATE_UNKNOWN: "Có văn bản thay đổi hoặc chấm dứt quy định nhưng chưa rõ ngày có hiệu lực",
    UNVERIFIED_RELATION: "Có văn bản tác động chưa được xác minh có thể ảnh hưởng tới quy định",
    UNRESOLVED_INSTRUCTION: "Có lệnh sửa đổi nêu đúng điều khoản này nhưng chưa xác định được phần bị tác động",
    OPEN_DOCUMENT_CANDIDATE: "Có dẫn chiếu cấp văn bản chưa được xác minh có thể tác động tới văn bản này",
};

const MODEL_REASON_PREFIX = "MODEL:";

/** Turns a stored uncertainty or warning code into a Vietnamese sentence; an unknown code is never shown raw. */
export function describeReason(code: string): string {
    if (code.startsWith(MODEL_REASON_PREFIX)) {
        return "Mô hình đọc văn bản báo không chắc chắn về nội dung này";
    }

    return REASON_TEXTS[code] ?? "Cần kiểm tra thủ công";
}
