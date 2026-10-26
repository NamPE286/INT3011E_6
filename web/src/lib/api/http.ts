import { isRecord, readString } from "./read";

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number | null,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

const STATUS_MESSAGES: Record<number, string> = {
    400: "Yêu cầu không hợp lệ",
    404: "Không tìm thấy dữ liệu",
    503: "Máy chủ chưa sẵn sàng, vui lòng thử lại sau",
};

/** Fetches JSON from the backend and turns every failure into an ApiError with a message safe to show. */
export async function requestJson(baseUrl: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
    let response: Response;

    try {
        response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, init);
    } catch {
        throw new ApiError("Không thể kết nối máy chủ", null);
    }

    if (!response.ok) {
        throw new ApiError(await readErrorMessage(response), response.status);
    }

    try {
        return await response.json();
    } catch {
        throw new ApiError("Máy chủ trả về dữ liệu không hợp lệ", response.status);
    }
}

async function readErrorMessage(response: Response): Promise<string> {
    try {
        const body: unknown = await response.json();
        const message = isRecord(body) ? readString(body, "message") : null;

        if (message) {
            return message;
        }
    } catch {
        // The body is not JSON; fall back to the status text below.
    }

    return STATUS_MESSAGES[response.status] ?? `Lỗi máy chủ (HTTP ${response.status})`;
}

export function invalidResponse(): ApiError {
    return new ApiError("Máy chủ trả về dữ liệu không hợp lệ", null);
}
