import { getDocumentActions, getJobDocument, getPreprocessingChecklist } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
    const [job, actions, checklist] = await loadOrFail(
        Promise.all([getJobDocument(fetch, params.jobId), getDocumentActions(fetch, params.jobId), getPreprocessingChecklist(fetch, params.jobId)]),
    );

    return { job, actions, checklist };
};
