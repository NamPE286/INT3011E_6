import { getDocument, getDocumentRelations, searchDocuments } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

const LABEL_LOOKUP_LIMIT = 50;

export const load: PageLoad = async ({ params, fetch }) => {
    const [document, relations, corpus] = await loadOrFail(
        Promise.all([getDocument(fetch, params.id), getDocumentRelations(fetch, params.id), searchDocuments(fetch, "", null, LABEL_LOOKUP_LIMIT)]),
    );

    return { document, relations, corpus: corpus.documents };
};
