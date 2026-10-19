import { describe, expect, test } from "bun:test";
import {
    isJobResponse,
    parseErrorMessage,
    parseJobList,
    parseUploadResponse,
    type JobSummary
} from "./file-processing-response";

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

test("accepts needs_review with backend explanation or no explanation", () => {
    expect(isJobResponse({
        status: "needs_review",
        step: "needs_review",
        progress: 55,
        error: "Text layer is unreadable"
    })).toBeTrue();

    expect(isJobResponse({
        status: "needs_review",
        step: "needs_review",
        progress: 30,
        error: null
    })).toBeTrue();

    expect(isJobResponse({
        status: "unknown",
        step: "needs_review",
        progress: 30,
        error: null
    })).toBeFalse();
});

test("keeps jobs that need review in the job list and skips malformed rows", () => {
    const job: JobSummary = {
        id: "job-1",
        filename: "nd100.pdf",
        fileSize: 4413905,
        status: "needs_review",
        step: "needs_review",
        progress: 100,
        error: "1 validation error(s)",
        createdAt: "2026-10-19T21:22:41.000Z"
    };

    expect(parseJobList({ jobs: [job, { id: 42 }] })).toEqual([job]);
    expect(parseJobList({ items: [] })).toBeNull();
});
