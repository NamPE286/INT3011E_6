import { describe, expect, test } from "bun:test";
import { isJobResponse, parseErrorMessage, parseUploadResponse } from "./file-processing-response";

describe("file processing responses", () => {
    test("accepts a valid upload response", () => {
        const response = parseUploadResponse('{"jobId":"job-123"}');

        expect(response).toEqual({ jobId: "job-123" });
    });

    test("rejects an upload response without a job ID", () => {
        const response = parseUploadResponse('{"status":"queued"}');

        expect(response).toBeNull();
    });

    test("rejects malformed JSON without throwing", () => {
        expect(parseUploadResponse("not-json")).toBeNull();
        expect(parseErrorMessage("not-json")).toBeNull();
    });

    test("extracts an error message only when it is a string", () => {
        expect(parseErrorMessage('{"message":"Upload failed"}')).toBe("Upload failed");
        expect(parseErrorMessage('{"message":500}')).toBeNull();
    });

    test("rejects a malformed job response", () => {
        const response = {
            status: "completed",
            step: "completed",
            progress: "100",
            error: null
        };

        expect(isJobResponse(response)).toBeFalse();
    });
});
