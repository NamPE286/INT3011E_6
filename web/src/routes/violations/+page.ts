import { searchViolations } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, fetch }) => {
    const query = url.searchParams.get("q") ?? "";

    return {
        query,
        violations: await loadOrFail(searchViolations(fetch, query)),
    };
};
