import { searchDocuments } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, fetch }) => {
    const query = url.searchParams.get("q") ?? "";
    const documentType = url.searchParams.get("type") || null;

    return {
        query,
        documentType,
        result: await loadOrFail(searchDocuments(fetch, query, documentType)),
    };
};
