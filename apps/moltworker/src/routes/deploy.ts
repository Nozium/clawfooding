import { Hono } from "hono";
import type { Env } from "../index.ts";

export const deployRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/deploy
 *
 * Deploy a ClawFooding test agent with a specific persona configuration.
 * This endpoint creates a new sandbox container instance configured for
 * the target site and selected personas.
 *
 * Body:
 * {
 *   target_url: string,        // The staging/dev site URL to test
 *   goal: string,              // What the test should accomplish
 *   personas: string[],        // Persona IDs to deploy (from /api/personas)
 *   model?: string,            // LLM model override
 *   auth?: {                   // Authentication for the target site
 *     method: string,
 *     credentials: Record<string, string>
 *   },
 *   permissions?: {            // Override default permissions
 *     url_allowlist: string[],
 *     url_denylist?: string[],
 *     max_requests_per_minute?: number,
 *     max_session_duration?: number
 *   },
 *   callback_url?: string      // Webhook URL for completion notification
 * }
 */
deployRoutes.post("/", async (c) => {
	const body = await c.req.json<{
		target_url: string;
		goal: string;
		personas: string[];
		model?: string;
		auth?: {
			method: string;
			credentials: Record<string, string>;
		};
		permissions?: {
			url_allowlist?: string[];
			url_denylist?: string[];
			max_requests_per_minute?: number;
			max_session_duration?: number;
		};
		callback_url?: string;
	}>();

	// Validate required fields
	if (!body.target_url) {
		return c.json({ error: "target_url is required" }, 400);
	}
	if (!body.goal) {
		return c.json({ error: "goal is required" }, 400);
	}

	// Validate URL format
	try {
		new URL(body.target_url);
	} catch {
		return c.json({ error: "Invalid target_url format" }, 400);
	}

	const deploymentId = crypto.randomUUID();
	const personas = body.personas?.length > 0
		? body.personas
		: ["haruka", "kenji", "yuki"];
	const model = body.model ?? c.env.DEFAULT_MODEL;

	// Build default permissions based on target URL
	const targetHost = new URL(body.target_url).origin;
	const permissions = {
		navigation: "allow" as const,
		click: "allow" as const,
		type: "allow" as const,
		submit: "allow" as const,
		delete: "deny" as const,
		download: "deny" as const,
		external_navigation: "deny" as const,
		max_requests_per_minute: body.permissions?.max_requests_per_minute ?? 30,
		max_session_duration: body.permissions?.max_session_duration ?? 600,
		url_allowlist: body.permissions?.url_allowlist ?? [`${targetHost}/**`],
		url_denylist: body.permissions?.url_denylist ?? [
			"*/admin/**",
			"*/billing/**",
			"*/internal/**",
		],
	};

	// Store deployment configuration
	const deployment = {
		id: deploymentId,
		status: "deploying",
		target_url: body.target_url,
		goal: body.goal,
		personas,
		model,
		permissions,
		auth: body.auth ? { method: body.auth.method } : null, // Don't store credentials in KV
		callback_url: body.callback_url,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		results: null,
	};

	await c.env.SESSION_KV.put(
		`deploy:${deploymentId}`,
		JSON.stringify(deployment),
		{ expirationTtl: 86400 },
	);

	// Store credentials separately with shorter TTL if provided
	if (body.auth?.credentials) {
		await c.env.SESSION_KV.put(
			`creds:${deploymentId}`,
			JSON.stringify(body.auth.credentials),
			{ expirationTtl: 3600 }, // 1h TTL for credentials
		);
	}

	// Log deployment
	await c.env.DB.prepare(
		`INSERT INTO deployments (id, target_url, goal, personas, model, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			deploymentId,
			body.target_url,
			body.goal,
			JSON.stringify(personas),
			model,
			"deploying",
			new Date().toISOString(),
		)
		.run()
		.catch(() => {
			// Graceful degradation if D1 not initialized
		});

	return c.json({
		deployment_id: deploymentId,
		status: "deploying",
		personas,
		model,
		permissions: {
			url_allowlist: permissions.url_allowlist,
			url_denylist: permissions.url_denylist,
			max_requests_per_minute: permissions.max_requests_per_minute,
			max_session_duration: permissions.max_session_duration,
		},
		endpoints: {
			status: `/api/deploy/${deploymentId}/status`,
			report: `/api/deploy/${deploymentId}/report`,
			billing: `/api/deploy/${deploymentId}/billing`,
			stop: `/api/deploy/${deploymentId}/stop`,
		},
		message: "Deployment initiated. Agent container is starting.",
	}, 201);
});

/**
 * GET /api/deploy/:id/status
 */
deployRoutes.get("/:id/status", async (c) => {
	const id = c.req.param("id");
	const data = await c.env.SESSION_KV.get(`deploy:${id}`);

	if (!data) {
		return c.json({ error: "Deployment not found" }, 404);
	}

	const deployment = JSON.parse(data);
	return c.json({
		id: deployment.id,
		status: deployment.status,
		target_url: deployment.target_url,
		goal: deployment.goal,
		personas: deployment.personas,
		model: deployment.model,
		created_at: deployment.created_at,
		updated_at: deployment.updated_at,
	});
});

/**
 * GET /api/deploy/:id/report
 */
deployRoutes.get("/:id/report", async (c) => {
	const id = c.req.param("id");
	const report = await c.env.REPORTS_BUCKET.get(`deploy-reports/${id}.json`);

	if (!report) {
		return c.json({
			error: "Report not available yet. Check deployment status.",
		}, 404);
	}

	return c.json(JSON.parse(await report.text()));
});

/**
 * GET /api/deploy/:id/billing
 *
 * Per-persona billing breakdown for a specific deployment.
 */
deployRoutes.get("/:id/billing", async (c) => {
	const id = c.req.param("id");
	const billing = await c.env.BILLING_BUCKET.get(`deploy-billing/${id}.jsonl`);

	if (!billing) {
		return c.json({
			error: "Billing data not available yet.",
		}, 404);
	}

	const text = await billing.text();
	const records = text
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));

	// Aggregate by persona
	const byPersona = new Map<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }>();
	for (const r of records) {
		const existing = byPersona.get(r.personaId) ?? {
			cost: 0,
			requests: 0,
			inputTokens: 0,
			outputTokens: 0,
		};
		existing.cost += r.costUSD;
		existing.requests += 1;
		existing.inputTokens += r.tokens.inputTokens;
		existing.outputTokens += r.tokens.outputTokens;
		byPersona.set(r.personaId, existing);
	}

	const totalCost = Array.from(byPersona.values()).reduce((s, v) => s + v.cost, 0);

	return c.json({
		deployment_id: id,
		total_cost_usd: totalCost,
		total_records: records.length,
		by_persona: Object.fromEntries(
			Array.from(byPersona.entries()).map(([pid, data]) => [
				pid,
				{
					...data,
					percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
				},
			]),
		),
	});
});

/**
 * POST /api/deploy/:id/stop
 *
 * Stop a running deployment.
 */
deployRoutes.post("/:id/stop", async (c) => {
	const id = c.req.param("id");
	const data = await c.env.SESSION_KV.get(`deploy:${id}`);

	if (!data) {
		return c.json({ error: "Deployment not found" }, 404);
	}

	const deployment = JSON.parse(data);
	deployment.status = "stopped";
	deployment.updated_at = new Date().toISOString();

	await c.env.SESSION_KV.put(
		`deploy:${id}`,
		JSON.stringify(deployment),
		{ expirationTtl: 86400 },
	);

	// Clean up credentials
	await c.env.SESSION_KV.delete(`creds:${id}`);

	return c.json({
		id,
		status: "stopped",
		message: "Deployment stopped. Credentials cleared.",
	});
});
