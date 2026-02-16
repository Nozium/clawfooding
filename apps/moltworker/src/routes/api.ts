import { Hono } from "hono";
import type { Env } from "../index.ts";

export const apiRoutes = new Hono<{ Bindings: Env }>();

// ── Test Execution ─────────────────────────────────────────────────────

/**
 * POST /api/test/run
 *
 * Start a new cognitive pattern test.
 * Body:
 * {
 *   target_url: string,
 *   goal: string,
 *   personas: string[],
 *   model?: string,
 *   dry_run?: boolean,
 *   permissions?: Permissions
 * }
 */
apiRoutes.post("/test/run", async (c) => {
	const body = await c.req.json<{
		target_url: string;
		goal: string;
		personas: string[];
		model?: string;
		dry_run?: boolean;
	}>();

	if (!body.target_url || !body.goal) {
		return c.json({ error: "target_url and goal are required" }, 400);
	}

	const testId = crypto.randomUUID();
	const model = body.model ?? c.env.DEFAULT_MODEL;
	const personas = body.personas?.length > 0
		? body.personas
		: ["haruka", "kenji", "yuki"];

	// Store test session
	await c.env.SESSION_KV.put(
		`test:${testId}`,
		JSON.stringify({
			id: testId,
			status: "queued",
			target_url: body.target_url,
			goal: body.goal,
			personas,
			model,
			dry_run: body.dry_run ?? false,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		}),
		{ expirationTtl: 86400 }, // 24h TTL
	);

	// Log to D1
	await c.env.DB.prepare(
		`INSERT INTO test_runs (id, target_url, goal, personas, model, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			testId,
			body.target_url,
			body.goal,
			JSON.stringify(personas),
			model,
			"queued",
			new Date().toISOString(),
		)
		.run()
		.catch(() => {
			// D1 may not be initialized yet - graceful degradation
		});

	return c.json({
		test_id: testId,
		status: "queued",
		personas,
		model,
		message: "Test queued. Use GET /api/test/:id/status to check progress.",
	}, 201);
});

/**
 * GET /api/test/:id/status
 *
 * Get the status of a running test.
 */
apiRoutes.get("/test/:id/status", async (c) => {
	const testId = c.req.param("id");
	const data = await c.env.SESSION_KV.get(`test:${testId}`);

	if (!data) {
		return c.json({ error: "Test not found" }, 404);
	}

	return c.json(JSON.parse(data));
});

/**
 * GET /api/test/:id/report
 *
 * Get the billing report for a completed test.
 */
apiRoutes.get("/test/:id/report", async (c) => {
	const testId = c.req.param("id");

	const report = await c.env.REPORTS_BUCKET.get(`reports/${testId}.json`);
	if (!report) {
		return c.json({ error: "Report not found. Test may still be running." }, 404);
	}

	const data = await report.text();
	return c.json(JSON.parse(data));
});

// ── Billing ────────────────────────────────────────────────────────────

/**
 * GET /api/billing
 *
 * Get aggregated billing data across all tests.
 * Query params:
 *   since: ISO date string
 *   until: ISO date string
 *   persona: filter by persona ID
 *   group_by: persona | model | test
 */
apiRoutes.get("/billing", async (c) => {
	const since = c.req.query("since");
	const until = c.req.query("until");
	const persona = c.req.query("persona");
	const groupBy = c.req.query("group_by") ?? "persona";

	// List billing logs from R2
	const listResult = await c.env.BILLING_BUCKET.list({
		prefix: "billing/",
	});

	const records: unknown[] = [];
	for (const object of listResult.objects) {
		const data = await c.env.BILLING_BUCKET.get(object.key);
		if (!data) continue;
		const text = await data.text();
		const lines = text.split("\n").filter((l) => l.trim());
		for (const line of lines) {
			try {
				const record = JSON.parse(line);
				// Apply filters
				if (since && record.timestamp < since) continue;
				if (until && record.timestamp > until) continue;
				if (persona && record.personaId !== persona) continue;
				records.push(record);
			} catch {
				// Skip malformed lines
			}
		}
	}

	return c.json({
		record_count: records.length,
		group_by: groupBy,
		records,
	});
});

// ── Personas ───────────────────────────────────────────────────────────

/**
 * GET /api/personas
 *
 * List available personas on the managed service.
 */
apiRoutes.get("/personas", async (c) => {
	const presets = [
		{
			id: "haruka",
			name: "Haruka (初心者)",
			description: "32歳、非エンジニア、初回利用。オンボーディング不備を検出。",
			detection_focus: ["onboarding", "jargon", "navigation_flow"],
		},
		{
			id: "kenji",
			name: "Kenji (急いでる人)",
			description: "45歳、マネージャー、時間がない。CTA視認性、ステップ過多を検出。",
			detection_focus: ["cta_visibility", "step_count", "confirmation_dialogs"],
		},
		{
			id: "yuki",
			name: "Yuki (パワーユーザー)",
			description: "28歳、エンジニア、毎日使う。ショートカット不在、一括操作不備を検出。",
			detection_focus: ["shortcuts", "bulk_operations", "efficiency_paths"],
		},
		{
			id: "takeshi",
			name: "Takeshi (高齢者)",
			description: "68歳、退職者、iPad利用。フォントサイズ、タッチターゲット、コントラストを検出。",
			detection_focus: ["font_size", "touch_target", "contrast"],
		},
		{
			id: "mika",
			name: "Mika (アクセシビリティ)",
			description: "25歳、視覚障害、スクリーンリーダー。aria-label、Tab順序、alt属性を検出。",
			detection_focus: ["aria_labels", "tab_order", "image_alt"],
		},
		{
			id: "chaos",
			name: "Chaos (エッジケース)",
			description: "予測不能な操作パターン。想定外入力、race condition、UI破壊を検出。",
			detection_focus: ["edge_cases", "race_conditions", "ui_breakage"],
		},
	];

	return c.json({ personas: presets });
});
