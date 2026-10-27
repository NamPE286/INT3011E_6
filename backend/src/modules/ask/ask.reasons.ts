const UNCERTAINTY_TEXTS: Record<string, string> = {
    NO_FINE: "chưa đọc được mức phạt",
    MULTIPLE_FINE_RANGES: "có nhiều mức phạt nhưng không phân biệt được đối tượng",
    LOW_READ_QUALITY: "chất lượng đọc văn bản thấp",
    CONFLICTING_SUSPENSIONS: "các hình thức tước giấy phép lái xe mâu thuẫn nhau",
    CONFLICTING_POINT_DEDUCTIONS: "số điểm bị trừ mâu thuẫn nhau",
    SEMANTIC_NOT_RETURNED: "chưa phân tích được nội dung hành vi",
    MODEL_NOT_A_VIOLATION: "nội dung này có thể không phải hành vi vi phạm",
    NO_ACTION: "chưa xác định được hành vi",
    EFFECTIVE_DATE_UNKNOWN: "chưa đọc được ngày có hiệu lực của văn bản chứa quy định",
    END_DATE_UNKNOWN: "có văn bản thay đổi hoặc chấm dứt quy định nhưng chưa rõ ngày có hiệu lực",
    UNVERIFIED_RELATION: "có văn bản tác động chưa được xác minh có thể ảnh hưởng tới quy định",
    UNRESOLVED_INSTRUCTION: "có lệnh sửa đổi nêu đúng điều khoản này nhưng chưa xác định được phần bị tác động",
    OPEN_DOCUMENT_CANDIDATE: "có dẫn chiếu cấp văn bản chưa được xác minh có thể tác động tới văn bản này",
};

const MODEL_UNCERTAINTY_PREFIX = "MODEL:";
const MODEL_UNCERTAINTY_TEXT = "mô hình đọc văn bản báo không chắc chắn về nội dung này";
const UNKNOWN_UNCERTAINTY_TEXT = "cần kiểm tra thủ công";

/** Turns a stored uncertainty or warning code into a Vietnamese reason; an unknown code is never shown raw. */
export function describeUncertainty(code: string): string {
    if (code.startsWith(MODEL_UNCERTAINTY_PREFIX)) {
        return MODEL_UNCERTAINTY_TEXT;
    }

    return UNCERTAINTY_TEXTS[code] ?? UNKNOWN_UNCERTAINTY_TEXT;
}
