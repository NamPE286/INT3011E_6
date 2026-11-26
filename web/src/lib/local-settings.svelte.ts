export type LocalModelOption = {
    id: string;
    label: string;
};

export const LOCAL_MODEL_OPTIONS: readonly LocalModelOption[] = [
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Free)" },
    { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen (Free)" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite (Free)" },
];

type PersistedSettings = {
    onboarded: boolean;
    apiKey: string;
    apiBaseUrl: string;
    model: string;
    autoLlm: boolean;
    useDecisionApi: boolean;
};

const STORAGE_KEY = "lexide-local-settings-v1";
const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

function loadInitialSettings(): PersistedSettings {
    const defaults: PersistedSettings = {
        onboarded: false,
        apiKey: "",
        apiBaseUrl: DEFAULT_GEMINI_URL,
        model: DEFAULT_GEMINI_MODEL,
        autoLlm: true,
        useDecisionApi: true,
    };

    if (typeof window === "undefined") {
        return defaults;
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return defaults;
        }

        const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
        const rawUrl = typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl.trim() : "";
        const rawModel = typeof parsed.model === "string" ? parsed.model.trim() : "";
        const isLegacyOpenAi = rawUrl.includes("openai.com") || rawModel.startsWith("gpt-");

        return {
            onboarded: Boolean(parsed.onboarded),
            apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
            apiBaseUrl: rawUrl && !isLegacyOpenAi ? rawUrl : defaults.apiBaseUrl,
            model: rawModel && !isLegacyOpenAi ? rawModel : defaults.model,
            autoLlm: typeof parsed.autoLlm === "boolean" ? parsed.autoLlm : true,
            useDecisionApi: typeof parsed.useDecisionApi === "boolean" ? parsed.useDecisionApi : true,
        };
    } catch {
        return defaults;
    }
}

function createLocalSettings() {
    const initial = loadInitialSettings();
    let onboarded = $state(initial.onboarded);
    let apiKey = $state(initial.apiKey);
    let apiBaseUrl = $state(initial.apiBaseUrl);
    let model = $state(initial.model);
    let autoLlm = $state(initial.autoLlm);
    let useDecisionApi = $state(initial.useDecisionApi);

    function persist(): void {
        if (typeof window === "undefined") {
            return;
        }

        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({ onboarded, apiKey, apiBaseUrl, model, autoLlm, useDecisionApi }),
            );
        } catch {
            // Ignore storage quota errors in restricted contexts.
        }
    }

    return {
        get onboarded() {
            return onboarded;
        },
        get apiKey() {
            return apiKey;
        },
        get apiBaseUrl() {
            return apiBaseUrl;
        },
        get model() {
            return model;
        },
        get autoLlm() {
            return autoLlm;
        },
        get useDecisionApi() {
            return useDecisionApi;
        },
        get hasApiKey() {
            return apiKey.trim().length > 0;
        },
        setApiKey(next: string) {
            apiKey = next.trim();

            if (apiKey.length === 0) {
                onboarded = false;
            }

            persist();
        },
        setApiBaseUrl(next: string) {
            apiBaseUrl = next.trim() || DEFAULT_GEMINI_URL;
            persist();
        },
        setModel(next: string) {
            model = next.trim() || DEFAULT_GEMINI_MODEL;
            persist();
        },
        setAutoLlm(next: boolean) {
            autoLlm = next;
            persist();
        },
        setUseDecisionApi(next: boolean) {
            useDecisionApi = next;
            persist();
        },
        saveAll(next: { apiKey: string; apiBaseUrl: string; model: string; autoLlm?: boolean; useDecisionApi?: boolean }) {
            apiKey = next.apiKey.trim();
            apiBaseUrl = next.apiBaseUrl.trim() || DEFAULT_GEMINI_URL;
            model = next.model.trim() || DEFAULT_GEMINI_MODEL;
            if (typeof next.autoLlm === "boolean") {
                autoLlm = next.autoLlm;
            }
            if (typeof next.useDecisionApi === "boolean") {
                useDecisionApi = next.useDecisionApi;
            }
            onboarded = apiKey.length > 0;
            persist();
        },
    };
}

export const localSettings = createLocalSettings();
