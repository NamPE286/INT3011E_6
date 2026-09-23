import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
	try {
		const res = await fetch("http://localhost:3000/health");
		const data = await res.json();
		return json(data, { status: res.status });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Backend unreachable";
		return json({ status: "error", message }, { status: 503 });
	}
};

