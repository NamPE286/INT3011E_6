import { getViolation, getViolationHistory, getViolationRulesAsOf, searchDocuments } from "$lib/api/client";
import { loadOrFail } from "$lib/api/load";
import { todayIso } from "$lib/format";
import type { PageLoad } from "./$types";

const LABEL_LOOKUP_LIMIT = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const load: PageLoad = async ({ params, url, fetch }) => {
    const requested = url.searchParams.get("as_of");
    const asOf = requested && ISO_DATE.test(requested) ? requested : todayIso();

    const [violation, rules, history, corpus] = await loadOrFail(
        Promise.all([
            getViolation(fetch, params.id),
            getViolationRulesAsOf(fetch, params.id, asOf),
            getViolationHistory(fetch, params.id),
            searchDocuments(fetch, "", null, LABEL_LOOKUP_LIMIT),
        ]),
    );

    return { asOf, violation, rules, history, corpus: corpus.documents };
};
