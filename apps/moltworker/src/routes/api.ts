import { Hono } from "hono";
import { BillingTracker, calculateCost } from "@clawfooding/core/billing";
import { buildAgentSystemPrompt, buildGoalPrompt } from "@clawfooding/core/prompts";
import {
	fittsMovementTime,
	hickDecisionTime,
	misclickProbability,
	cognitiveLoadScore,
} from "@clawfooding/core/cognitive";
import { createPersonaId, createModelName, createSessionId } from "@clawfooding/core/types";
import type { PersonaId, Persona, TokenUsage } from "@clawfooding/core/types";
import type { Env } from "../index.ts";
import { PRESET_PERSONAS } from "../_personas.ts";

export const apiRoutes = new Hono<{ Bindings: Env }>();

// ── Test Execution ─────────────────────────────────────────────────────

/**
 * POST /api/test/run
 *
 * Start a new cognitive pattern test.
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
	const personaIds = body.personas?.length > 0
		? body.personas
		: ["haruka", "kenji", "yuki"];

	// Validate personas exist
	const invalidPersonas = personaIds.filter((p) => !PRESET_PERSONAS[p]);
	if (invalidPersonas.length > 0) {
		return c.json({
			error: `Unknown personas: ${invalidPersonas.join(", ")}`,
			available: Object.keys(PRESET_PERSONAS),
		}, 400);
	}

	// Generate system prompts for each persona (preview)
	const personaPrompts = personaIds.map((pid) => {
		const persona = PRESET_PERSONAS[pid]!;
		return {
			persona_id: pid,
			persona_name: persona.name,
			system_prompt_preview: buildAgentSystemPrompt(persona).slice(0, 200) + "...",
			cognitive_metrics: {
				fitts_movement_300px_44btn: Math.round(fittsMovementTime(300, 44, persona.motor_profile)),
				hick_decision_7choices: Math.round(hickDecisionTime(7, persona.cognitive_profile)),
				misclick_probability: Number(misclickProbability(300, 44, persona.motor_profile).toFixed(3)),
			},
		};
	});

	// Store test session
	await c.env.SESSION_KV.put(
		`test:${testId}`,
		JSON.stringify({
			id: testId,
			status: "queued",
			target_url: body.target_url,
			goal: body.goal,
			personas: personaIds,
			model,
			dry_run: body.dry_run ?? false,
			persona_prompts: personaPrompts,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		}),
		{ expirationTtl: 86400 },
	);

	// Log to D1
	await c.env.DB.prepare(
		`INSERT INTO test_runs (id, target_url, goal, personas, model, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(testId, body.target_url, body.goal, JSON.stringify(personaIds), model, "queued", new Date().toISOString())
		.run()
		.catch(() => { /* D1 may not be initialized - graceful degradation */ });

	return c.json({
		test_id: testId,
		status: "queued",
		personas: personaPrompts,
		model,
		endpoints: {
			status: `/api/test/${testId}/status`,
			report: `/api/test/${testId}/report`,
		},
		message: "Test queued. Use GET /api/test/:id/status to check progress.",
	}, 201);
});

/**
 * GET /api/test/:id/status
 */
apiRoutes.get("/test/:id/status", async (c) => {
	const testId = c.req.param("id");
	const data = await c.env.SESSION_KV.get(`test:${testId}`);
	if (!data) return c.json({ error: "Test not found" }, 404);
	return c.json(JSON.parse(data));
});

/**
 * GET /api/test/:id/report
 */
apiRoutes.get("/test/:id/report", async (c) => {
	const testId = c.req.param("id");
	const report = await c.env.REPORTS_BUCKET.get(`reports/${testId}.json`);
	if (!report) return c.json({ error: "Report not found. Test may still be running." }, 404);
	return c.json(JSON.parse(await report.text()));
});

// ── Billing ────────────────────────────────────────────────────────────

/**
 * GET /api/billing
 *
 * Aggregated billing with BillingTracker.
 */
apiRoutes.get("/billing", async (c) => {
	const since = c.req.query("since");
	const until = c.req.query("until");
	const persona = c.req.query("persona");

	const tracker = new BillingTracker();

	// Load billing records from R2
	const listResult = await c.env.BILLING_BUCKET.list({ prefix: "billing/" });

	for (const object of listResult.objects) {
		const data = await c.env.BILLING_BUCKET.get(object.key);
		if (!data) continue;
		const text = await data.text();
		tracker.importJsonl(text);
	}

	// Build persona name map
	const personaNameMap = new Map<PersonaId, string>();
	for (const [id, p] of Object.entries(PRESET_PERSONAS)) {
		personaNameMap.set(createPersonaId(id), p.name);
	}

	const report = tracker.generateReport("All Tests", personaNameMap);

	// Apply filters
	if (persona) {
		report.personas = report.personas.filter((p) => String(p.personaId) === persona);
	}

	return c.json({
		...report,
		filters: { since, until, persona },
	});
});

// ── Personas ───────────────────────────────────────────────────────────

/**
 * GET /api/personas
 *
 * List available personas with cognitive metrics.
 */
apiRoutes.get("/personas", async (c) => {
	const personas = Object.entries(PRESET_PERSONAS).map(([id, persona]) => ({
		id,
		name: persona.name,
		description: persona.description ?? "",
		demographics: persona.demographics,
		cognitive_summary: {
			navigation: persona.cognitive_profile.navigation_strategy,
			error_recovery: persona.cognitive_profile.error_recovery,
			reading_pattern: persona.cognitive_profile.reading_pattern,
			working_memory: persona.cognitive_profile.working_memory_load,
		},
		derived_metrics: {
			fitts_movement_ms: Math.round(fittsMovementTime(300, 44, persona.motor_profile)),
			hick_decision_ms: Math.round(hickDecisionTime(7, persona.cognitive_profile)),
			misclick_probability: Number(misclickProbability(300, 44, persona.motor_profile).toFixed(3)),
		},
	}));

	return c.json({ personas });
});

/**
 * GET /api/personas/:id/prompt
 *
 * Preview the generated system prompt for a persona.
 */
apiRoutes.get("/personas/:id/prompt", async (c) => {
	const id = c.req.param("id");
	const persona = PRESET_PERSONAS[id];
	if (!persona) return c.json({ error: `Persona "${id}" not found` }, 404);

	const systemPrompt = buildAgentSystemPrompt(persona);
	return c.json({
		persona_id: id,
		persona_name: persona.name,
		system_prompt: systemPrompt,
		token_estimate: Math.ceil(systemPrompt.length / 4),
	});
});
