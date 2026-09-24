<script lang="ts">
    import { onDestroy } from "svelte";
    import { PUBLIC_BACKEND_URL } from "$env/static/public";
    import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "$lib/components/ui/card";
    import { Button } from "$lib/components/ui/button";
    import { Badge } from "$lib/components/ui/badge";
    import {
        isJobResponse,
        parseErrorMessage,
        parseUploadResponse,
        type ProcessingStep
    } from "$lib/file-processing-response";
    import {
        Upload,
        FileText,
        CheckCircle2,
        AlertCircle,
        Loader2,
        RefreshCw,
        Circle,
        ArrowRight
    } from "@lucide/svelte";

    type UIState = "idle" | "uploading" | "processing" | "completed" | "failed";
    type StepState = "done" | "active" | "pending" | "failed";

    const DEFAULT_BACKEND_URL = PUBLIC_BACKEND_URL;
    const POLL_INTERVAL_MS = 1000;
    const MAX_POLL_FAILURES = 10;
    const PROCESSING_STEP_ORDER = ["preparing", "extracting", "analyzing", "finalizing", "completed"] as const;

    let backendBaseUrl = $state(DEFAULT_BACKEND_URL);
    let uiState = $state<UIState>("idle");
    let selectedFile = $state<File | null>(null);
    let fileInputRef = $state<HTMLInputElement | null>(null);

    let uploadProgress = $state(0);
    let uploadLoadedBytes = $state(0);
    let uploadTotalBytes = $state(0);

    let jobId = $state<string | null>(null);
    let currentStep = $state<ProcessingStep | null>(null);
    let processingProgress = $state(0);
    let errorMessage = $state<string | null>(null);

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let pollInFlight = false;
    let consecutivePollFailures = 0;

    const PIPELINE_STEPS = [
        { key: "upload", label: "Upload completed" },
        { key: "preparing", label: "Preparing document" },
        { key: "extracting", label: "Extracting content" },
        { key: "analyzing", label: "Analyzing provisions" },
        { key: "finalizing", label: "Finalizing" },
        { key: "completed", label: "Processing completed" }
    ] as const;

    function formatBytes(bytes: number): string {
        if (bytes === 0) {
            return "0 B";
        }

        const unit = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const unitIndex = Math.floor(Math.log(bytes) / Math.log(unit));

        return `${(bytes / Math.pow(unit, unitIndex)).toFixed(1)} ${sizes[unitIndex]}`;
    }

    function handleFileSelect(event: Event) {
        const target = event.currentTarget;

        if (!(target instanceof HTMLInputElement)) {
            return;
        }

        const [file] = target.files ?? [];

        if (file) {
            selectedFile = file;
            errorMessage = null;
        }
    }

    function fail(message: string) {
        stopPolling();
        uiState = "failed";
        errorMessage = message;
    }

    function startUpload() {
        if (!selectedFile) {
            return;
        }

        uiState = "uploading";
        uploadProgress = 0;
        uploadLoadedBytes = 0;
        uploadTotalBytes = selectedFile.size;
        errorMessage = null;
        jobId = null;
        currentStep = null;
        processingProgress = 0;

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${backendBaseUrl}/api/uploads`, true);

        xhr.upload.onprogress = (event: ProgressEvent) => {
            if (event.lengthComputable) {
                uploadLoadedBytes = event.loaded;
                uploadTotalBytes = event.total;
                uploadProgress = Math.min(100, Math.round((event.loaded / event.total) * 100));
            }
        };

        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                const responseMessage = parseErrorMessage(xhr.responseText);
                const fallbackMessage = xhr.statusText || "Request error";
                fail(responseMessage || `Upload failed with HTTP ${xhr.status}: ${fallbackMessage}`);

                return;
            }

            const uploadResponse = parseUploadResponse(xhr.responseText);

            if (!uploadResponse) {
                fail("Upload response is missing a valid job ID");

                return;
            }

            uploadProgress = 100;
            jobId = uploadResponse.jobId;
            uiState = "processing";
            currentStep = "queued";
            startPolling(uploadResponse.jobId);
        };

        xhr.onerror = () => {
            fail(`Could not connect to ${backendBaseUrl}. Make sure the Cloudflare Worker is running.`);
        };

        const formData = new FormData();
        formData.append("file", selectedFile);
        xhr.send(formData);
    }

    function startPolling(id: string) {
        stopPolling();
        consecutivePollFailures = 0;

        void pollJobStatus(id);
        pollInterval = setInterval(() => {
            void pollJobStatus(id);
        }, POLL_INTERVAL_MS);
    }

    async function pollJobStatus(id: string) {
        if (pollInFlight) {
            return;
        }

        pollInFlight = true;

        try {
            const res = await fetch(`${backendBaseUrl}/api/jobs/${id}`);

            if (res.status === 404) {
                fail("Job not found on server (404)");
                return;
            }

            if (!res.ok) {
                consecutivePollFailures++;
                if (consecutivePollFailures >= MAX_POLL_FAILURES) {
                    fail(`Polling failed repeatedly (HTTP ${res.status})`);
                }
                return;
            }

            consecutivePollFailures = 0;
            const jobResponse: unknown = await res.json();

            if (!isJobResponse(jobResponse)) {
                fail("Server returned an invalid job response");

                return;
            }

            currentStep = jobResponse.step;
            processingProgress = jobResponse.progress;

            if (jobResponse.status === "completed") {
                stopPolling();
                uiState = "completed";
                currentStep = "completed";
                processingProgress = 100;
            } else if (jobResponse.status === "failed") {
                fail(jobResponse.error || "Processing failed in queue consumer");
            }
        } catch (err: unknown) {
            consecutivePollFailures++;
            if (consecutivePollFailures >= MAX_POLL_FAILURES) {
                fail(err instanceof Error ? err.message : "Lost connection while polling job status");
            }
        } finally {
            pollInFlight = false;
        }
    }

    function stopPolling() {
        if (pollInterval !== null) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    function reset() {
        stopPolling();
        uiState = "idle";
        selectedFile = null;
        uploadProgress = 0;
        uploadLoadedBytes = 0;
        uploadTotalBytes = 0;
        jobId = null;
        currentStep = null;
        processingProgress = 0;
        errorMessage = null;
        if (fileInputRef) {
            fileInputRef.value = "";
        }
    }

    onDestroy(() => {
        stopPolling();
    });

    function getStepState(stepKey: string): StepState {
        if (uiState === "idle") {
            return "pending";
        }

        if (stepKey === "upload") {
            if (uiState === "uploading") {
                return "active";
            }

            if (uiState === "failed" && !jobId) {
                return "failed";
            }

            return "done";
        }

        if (uiState === "uploading") {
            return "pending";
        }

        if (uiState === "failed" && stepKey === currentStep) {
            return "failed";
        }

        if (uiState === "completed") {
            return "done";
        }

        const currentIndex = PROCESSING_STEP_ORDER.findIndex((step) => step === currentStep);
        const stepIndex = PROCESSING_STEP_ORDER.findIndex((step) => step === stepKey);

        if (currentIndex === -1) {
            return stepIndex === 0 && currentStep === "queued" ? "active" : "pending";
        }

        if (stepIndex < currentIndex) {
            return "done";
        }

        if (stepIndex === currentIndex) {
            return "active";
        }

        return "pending";
    }
</script>

<Card class="w-full max-w-xl shadow-sm border bg-card">
    <CardHeader>
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
                <Upload class="size-5 text-primary" />
                <CardTitle class="text-xl font-bold">Cloudflare File Processing Demo</CardTitle>
            </div>

            {#if uiState === "idle"}
                <Badge variant="outline">Idle</Badge>
            {:else if uiState === "uploading"}
                <Badge variant="secondary" class="gap-1 bg-amber-500/10 text-amber-600 border-amber-200">
                    <Loader2 class="size-3 animate-spin" />
                    Uploading
                </Badge>
            {:else if uiState === "processing"}
                <Badge variant="secondary" class="gap-1 bg-blue-500/10 text-blue-600 border-blue-200">
                    <Loader2 class="size-3 animate-spin" />
                    Processing (~15s)
                </Badge>
            {:else if uiState === "completed"}
                <Badge class="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                    <CheckCircle2 class="size-3" />
                    Completed
                </Badge>
            {:else if uiState === "failed"}
                <Badge variant="destructive" class="gap-1">
                    <AlertCircle class="size-3" />
                    Failed
                </Badge>
            {/if}
        </div>
        <CardDescription>
            Uploads to Cloudflare R2, writes job to D1, triggers Queue consumer, and polls status.
        </CardDescription>
    </CardHeader>

    <CardContent class="space-y-5">
        <!-- Configuration: Backend Target -->
        <div class="rounded-md border p-2.5 bg-muted/40 flex items-center justify-between gap-3 text-xs">
            <span class="font-medium text-muted-foreground whitespace-nowrap">Worker URL:</span>
            <input
                type="text"
                bind:value={backendBaseUrl}
                disabled={uiState === "uploading" || uiState === "processing"}
                class="font-mono text-xs px-2 py-1 rounded border bg-background flex-1 max-w-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
        </div>

        <!-- File Selector -->
        {#if uiState === "idle"}
            <div class="space-y-3">
                <label
                    for="file-upload"
                    class="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/60 transition-colors bg-muted/10 hover:bg-muted/20"
                >
                    <FileText class="size-8 text-muted-foreground" />
                    <div class="text-sm font-medium">
                        {#if selectedFile}
                            <span class="text-primary font-semibold">{selectedFile.name}</span>
                            <span class="text-muted-foreground ml-1 text-xs">({formatBytes(selectedFile.size)})</span>
                        {:else}
                            <span>Click to select document or file</span>
                        {/if}
                    </div>
                    <p class="text-xs text-muted-foreground">Supported files up to 50MB</p>
                    <input
                        id="file-upload"
                        type="file"
                        bind:this={fileInputRef}
                        onchange={handleFileSelect}
                        class="hidden"
                    />
                </label>
            </div>
        {/if}

        <!-- Uploading State (REAL Progress) -->
        {#if uiState === "uploading"}
            <div class="space-y-2 border rounded-lg p-4 bg-muted/20">
                <div class="flex items-center justify-between text-sm">
                    <div class="flex items-center gap-2 font-medium">
                        <FileText class="size-4 text-primary" />
                        <span class="truncate max-w-[200px]">{selectedFile?.name}</span>
                    </div>
                    <span class="font-mono text-xs font-semibold">{uploadProgress}%</span>
                </div>

                <!-- Real Progress Bar -->
                <div class="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                        class="bg-primary h-full transition-all duration-150 ease-out"
                        style="width: {uploadProgress}%"
                    ></div>
                </div>

                <div class="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Uploading bytes...</span>
                    <span class="font-mono">
                        {formatBytes(uploadLoadedBytes)} / {formatBytes(uploadTotalBytes)}
                    </span>
                </div>
            </div>
        {/if}

        <!-- Processing & Step Visualizer -->
        {#if uiState === "processing" || uiState === "completed" || (uiState === "failed" && jobId)}
            <div class="space-y-4 border rounded-lg p-4 bg-muted/20">
                <div class="flex items-center justify-between text-xs">
                    <span class="text-muted-foreground font-mono">Job ID: {jobId}</span>
                    <span class="font-semibold text-primary font-mono">{processingProgress}%</span>
                </div>

                <!-- Backend Progress Bar -->
                <div class="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                        class="bg-primary h-full transition-all duration-300"
                        style="width: {processingProgress}%"
                    ></div>
                </div>

                <!-- Step by Step List -->
                <div class="space-y-2.5 pt-2">
                    {#each PIPELINE_STEPS as step}
                        {@const state = getStepState(step.key)}
                        <div class="flex items-center justify-between text-xs">
                            <div class="flex items-center gap-2">
                                {#if state === "done"}
                                    <CheckCircle2 class="size-4 text-emerald-600" />
                                    <span class="text-foreground font-medium">{step.label}</span>
                                {:else if state === "active"}
                                    <Loader2 class="size-4 text-blue-600 animate-spin" />
                                    <span class="text-blue-600 font-semibold">{step.label}</span>
                                {:else if state === "failed"}
                                    <AlertCircle class="size-4 text-destructive" />
                                    <span class="text-destructive font-semibold">{step.label} (failed)</span>
                                {:else}
                                    <Circle class="size-4 text-muted-foreground/40" />
                                    <span class="text-muted-foreground">{step.label}</span>
                                {/if}
                            </div>

                            <div>
                                {#if state === "done"}
                                    <span class="text-[11px] text-emerald-600 font-medium">Done</span>
                                {:else if state === "active"}
                                    <span class="text-[11px] text-blue-600 font-medium animate-pulse">Running</span>
                                {:else if state === "failed"}
                                    <span class="text-[11px] text-destructive font-medium">Failed</span>
                                {:else}
                                    <span class="text-[11px] text-muted-foreground/50">Pending</span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Error Message Alert -->
        {#if uiState === "failed" && errorMessage}
            <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive text-xs space-y-1">
                <div class="font-semibold flex items-center gap-1.5">
                    <AlertCircle class="size-4" />
                    Operation Failed
                </div>
                <p>{errorMessage}</p>
            </div>
        {/if}

        <!-- Completed Success Banner -->
        {#if uiState === "completed"}
            <div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 class="size-4 shrink-0 text-emerald-600" />
                <div>
                    <span class="font-semibold">Processing pipeline finished successfully!</span>
                    All stages persisted in Cloudflare D1.
                </div>
            </div>
        {/if}
    </CardContent>

    <CardFooter class="flex items-center justify-between border-t pt-4">
        {#if uiState === "idle"}
            <Button variant="outline" size="sm" href="/health">
                Backend Health
            </Button>

            <Button
                size="sm"
                disabled={!selectedFile}
                onclick={startUpload}
                class="gap-1.5"
            >
                <Upload class="size-4" />
                Upload & Process
            </Button>
        {:else if uiState === "uploading" || uiState === "processing"}
            <div class="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 class="size-3.5 animate-spin text-primary" />
                <span>Do not close this tab during processing...</span>
            </div>
        {:else}
            <Button variant="outline" size="sm" onclick={reset} class="gap-1.5 ml-auto">
                <RefreshCw class="size-3.5" />
                Upload Another File
            </Button>
        {/if}
    </CardFooter>
</Card>
