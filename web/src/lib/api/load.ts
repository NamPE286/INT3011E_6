import { error } from "@sveltejs/kit";
import { ApiError } from "./http";

/** Runs a page's backend request; a failure becomes the SvelteKit error page instead of an empty screen. */
export async function loadOrFail<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (cause: unknown) {
        if (cause instanceof ApiError) {
            error(cause.status === 404 ? 404 : 502, cause.message);
        }

        throw cause;
    }
}
