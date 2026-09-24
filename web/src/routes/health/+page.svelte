<script lang="ts">
	import { onMount } from "svelte";
	import { PUBLIC_BACKEND_URL } from "$env/static/public";
	import { Button } from "$lib/components/ui/button";
	import { Badge } from "$lib/components/ui/badge";
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
		CardFooter
	} from "$lib/components/ui/card";
	import { Activity, RefreshCw, CheckCircle2, AlertCircle } from "@lucide/svelte";

	let endpoint = $state(`${PUBLIC_BACKEND_URL}/health`);
	let status = $state<"idle" | "loading" | "success" | "error">("idle");
	let statusCode = $state<number | null>(null);
	let responseData = $state<Record<string, unknown> | null>(null);
	let responseTimeMs = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);

	async function checkHealth() {
		status = "loading";
		errorMessage = null;
		const startTime = performance.now();

		try {
			let res: Response;
			try {
				res = await fetch(endpoint);
			} catch {
				// Fallback to internal API route if direct cross-origin request is blocked
				res = await fetch("/api/health");
			}

			statusCode = res.status;
			responseTimeMs = Math.round(performance.now() - startTime);

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${res.statusText || "Request failed"}`);
			}

			const json = (await res.json()) as Record<string, unknown>;
			responseData = json;
			status = "success";
		} catch (err: unknown) {
			responseTimeMs = Math.round(performance.now() - startTime);
			status = "error";
			errorMessage = err instanceof Error ? err.message : "Failed to fetch health status";
			responseData = null;
		}
	}

	onMount(() => {
		checkHealth();
	});
</script>

<div class="flex min-h-screen items-center justify-center p-6 bg-muted/30">
	<div class="w-full max-w-lg space-y-4">
		<Card class="shadow-sm border">
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Activity class="size-5 text-primary" />
						<CardTitle class="text-xl font-semibold">Health Status</CardTitle>
					</div>

					{#if status === "loading"}
						<Badge variant="secondary" class="gap-1.5">
							<RefreshCw class="size-3 animate-spin" />
							Checking...
						</Badge>
					{:else if status === "success"}
						<Badge variant="default" class="gap-1.5 bg-emerald-600 hover:bg-emerald-600 text-white">
							<CheckCircle2 class="size-3" />
							{statusCode ? `HTTP ${statusCode}` : "Healthy"}
						</Badge>
					{:else if status === "error"}
						<Badge variant="destructive" class="gap-1.5">
							<AlertCircle class="size-3" />
							{statusCode ? `HTTP ${statusCode}` : "Failed"}
						</Badge>
					{:else}
						<Badge variant="outline">Idle</Badge>
					{/if}
				</div>
				<CardDescription>
					Testing ElysiaJS backend <code class="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">/health</code> with shadcn-svelte components.
				</CardDescription>
			</CardHeader>

			<CardContent class="space-y-4">
				<div class="rounded-md border p-3 bg-muted/40 space-y-1.5 text-sm">
					<div class="flex justify-between items-center text-muted-foreground text-xs font-medium">
						<span>TARGET ENDPOINT</span>
						{#if responseTimeMs !== null}
							<span>{responseTimeMs}ms</span>
						{/if}
					</div>
					<div class="font-mono text-xs break-all">{endpoint}</div>
				</div>

				<div class="space-y-1.5">
					<div class="text-xs font-medium text-muted-foreground uppercase">Response Body</div>
					{#if status === "loading"}
						<div class="flex items-center justify-center py-8 text-muted-foreground text-sm border rounded-lg bg-background">
							<RefreshCw class="size-4 animate-spin mr-2" />
							Sending request...
						</div>
					{:else if status === "success" && responseData}
						<pre class="bg-muted p-3.5 rounded-lg font-mono text-xs overflow-x-auto text-foreground border"><code>{JSON.stringify(responseData, null, 4)}</code></pre>
					{:else if status === "error"}
						<div class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs">
							<div class="font-semibold mb-1">Failed to connect</div>
							<div>{errorMessage}</div>
						</div>
					{/if}
				</div>
			</CardContent>

			<CardFooter class="flex items-center justify-between border-t pt-4">
				<Button variant="outline" size="sm" href="/">
					Back to Home
				</Button>

				<Button
					size="sm"
					onclick={checkHealth}
					disabled={status === "loading"}
					class="gap-1.5"
				>
					<RefreshCw class="size-3.5 {status === 'loading' ? 'animate-spin' : ''}" />
					Call /health
				</Button>
			</CardFooter>
		</Card>
	</div>
</div>
