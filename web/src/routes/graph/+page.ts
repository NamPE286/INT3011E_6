import { getRelationGraph } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ url, fetch }) => {
    const graph = await loadOrFail(getRelationGraph(fetch));
    const requestedFocus = url.searchParams.get("document");
    const focusDocumentId = graph.documents.some((document) => document.id === requestedFocus) ? requestedFocus : null;

    return { graph, focusDocumentId };
};
