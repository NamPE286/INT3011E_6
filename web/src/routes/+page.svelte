<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "$lib/components/ui/card";
	import { Activity } from "@lucide/svelte";
</script>

<div class="flex min-h-screen items-center justify-center p-6 bg-muted/30">
	<Card class="w-full max-w-md shadow-sm border">
		<CardHeader>
			<CardTitle class="text-2xl font-bold">Web App</CardTitle>
			<CardDescription>SvelteKit + Tailwind CSS + shadcn-svelte</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			<p class="text-sm text-muted-foreground">
				Explore the backend health status test page to verify connectivity and shadcn-svelte UI components.
			</p>
			<div>
				<Button href="/health" class="gap-2">
					<Activity class="size-4" />
					Check Health Page
				</Button>
			</div>
		</CardContent>
	</Card>
</div>
