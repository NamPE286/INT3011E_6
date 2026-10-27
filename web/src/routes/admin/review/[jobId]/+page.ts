import { getDocumentActions, getJobDocument } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
    const [job, actions] = await loadOrFail(Promise.all([getJobDocument(fetch, params.jobId), getDocumentActions(fetch, params.jobId)]));

    return { job, actions };
};
