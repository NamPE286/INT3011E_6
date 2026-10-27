import { describe, expect, test } from "bun:test";
import { ApiError, requestJson } from "./http";

function respond(body: BodyInit | null, status = 200): typeof fetch {
    return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("requestJson", () => {
    test("returns the parsed body and joins the base url without a double slash", async () => {
        let requested = "";
        const fetcher = (async (url: string) => {
            requested = url;

            return Response.json({ ok: true });
        }) as unknown as typeof fetch;

        expect(await requestJson("http://api.test/", "/api/x", {}, fetcher)).toEqual({ ok: true });
        expect(requested).toBe("http://api.test/api/x");
    });

    test("uses the backend message for an error response", async () => {
        const promise = requestJson("http://api.test", "/x", {}, respond(JSON.stringify({ message: "Legal document not found" }), 404));

        await expect(promise).rejects.toMatchObject({ message: "Legal document not found", status: 404 });
    });

    test("falls back to a status message when the error body is not JSON", async () => {
        const promise = requestJson("http://api.test", "/x", {}, respond("<html>", 503));

        await expect(promise).rejects.toMatchObject({ status: 503 });
        await expect(promise).rejects.toBeInstanceOf(ApiError);
    });

    test("reports a network failure without leaking the cause", async () => {
        const failing = (async () => {
            throw new TypeError("connect ECONNREFUSED 10.0.0.1:8787");
        }) as unknown as typeof fetch;

        await expect(requestJson("http://api.test", "/x", {}, failing)).rejects.toMatchObject({ message: "Không thể kết nối máy chủ", status: null });
    });

    test("rejects a success response that is not JSON", async () => {
        await expect(requestJson("http://api.test", "/x", {}, respond("oops"))).rejects.toMatchObject({ message: "Máy chủ trả về dữ liệu không hợp lệ" });
    });
});
