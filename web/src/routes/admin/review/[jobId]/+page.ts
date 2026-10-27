import { getJobDocument } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
    const job = await loadOrFail(getJobDocument(fetch, params.jobId));

    return { job };
};
