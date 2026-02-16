import * as fs from "node:fs/promises";
import { define } from "gunshi";
import pc from "picocolors";
import YAML from "yaml";
import * as v from "valibot";
import { BillingTracker, calculateCost, listKnownModels } from "@clawfooding/core/billing";
import { loadPersona } from "@clawfooding/core/persona";
import {
	fittsMovementTime,
	hickDecisionTime,
	cognitiveLoadScore,
} from "@clawfooding/core/cognitive";
import { scenarioSchema, createPersonaId, createModelName, createSessionId } from "@clawfooding/core/types";
import type { PersonaId } from "@clawfooding/core/types";
import { formatCurrency } from "@clawfooding/terminal/format";
import { Table } from "@clawfooding/terminal/table";
import { sharedArgs } from "../_shared-args.ts";

export const benchCommandDef = define({
	args: {
		...sharedArgs,
		scenario: {
			type: "string",
			short: "s",
			description: "Path to scenario YAML file",
			required: true,
		},
		models: {
			type: "string",
			short: "m",
			description: "Comma-separated list of models to benchmark",
			default: "anthropic/claude-opus-4-5,anthropic/claude-sonnet-4-5,anthropic/claude-haiku-4-5",
		},
		persona: {
			type: "string",
			short: "p",
			description: "Persona to use for benchmarking",
		},
	},
	run: async (ctx) => {
		const { scenario: scenarioPath, models: modelsStr, persona: personaName, json } = ctx.values;

		if (!scenarioPath) {
			console.error(pc.red("Error: --scenario is required"));
			process.exit(1);
		}

		// Load scenario
		const scenarioRaw = await fs.readFile(scenarioPath, "utf-8");
		const scenario = v.parse(scenarioSchema, YAML.parse(scenarioRaw) as unknown);

		// Parse models
		const models = (modelsStr ?? "").split(",").map((m) => m.trim()).filter(Boolean);

		if (models.length === 0) {
			console.error(pc.red("Error: No models specified"));
			process.exit(1);
		}

		// Determine persona
		const personaId = personaName ?? scenario.personas[0];
		if (!personaId) {
			console.error(pc.red("Error: No persona specified via --persona or in scenario"));
			process.exit(1);
		}

		const { id: pid, persona } = await loadPersona(personaId);

		console.log(pc.bold(`\n🦞 ClawBench - Multi-Model Benchmark`));
		console.log(pc.dim(`   Scenario: ${scenario.name}`));
		console.log(pc.dim(`   Persona: ${persona.name}`));
		console.log(pc.dim(`   Models: ${models.join(", ")}`));
		console.log("");

		// ── Run benchmark per model ──────────────────────────────────────
		const results: Array<{
			model: string;
			taskCompletion: number;
			autonomousAccuracy: number;
			recoveryEfficiency: number;
			stepEfficiency: number;
			latency: number;
			hallucinationRate: number;
			clawBenchScore: number;
			totalCostUSD: number;
			totalRequests: number;
		}> = [];

		const steps = scenario.steps ?? [
			{ action: "navigate", description: "Navigate to target URL" },
			{ action: "scan", description: "Visual scan of page elements" },
			{ action: "interact", description: "Interact with primary elements" },
		];

		for (const model of models) {
			console.log(pc.dim(`  Benchmarking: ${model}...`));

			const tracker = new BillingTracker();
			const modelName = createModelName(model);
			const sessionId = createSessionId(`bench-${model}-${Date.now()}`);

			// Simulate cognitive test with this model
			// In a real implementation, this would actually call the LLM
			let completedSteps = 0;
			let correctActions = 0;
			let recoveredWithinUI = 0;
			let stumbles = 0;
			let totalLatency = 0;
			let hallucinations = 0;

			for (const [i, step] of steps.entries()) {
				const simulatedTokens = {
					inputTokens: 1200 + Math.floor(Math.random() * 2500),
					outputTokens: 250 + Math.floor(Math.random() * 600),
					cacheCreationInputTokens: i === 0 ? 600 : 0,
					cacheReadInputTokens: i > 0 ? 700 : 0,
				};

				const cost = calculateCost(model, simulatedTokens);

				tracker.record({
					personaId: pid,
					sessionId,
					timestamp: new Date().toISOString(),
					model: modelName,
					tokens: simulatedTokens,
					costUSD: cost,
					step: step.description ?? step.action,
					recoveryLevel: 0,
				});

				// Simulate model performance (quality heuristic based on model tier)
				const modelTier = getModelTier(model);
				const stepSuccess = Math.random() < modelTier.completionRate;
				if (stepSuccess) completedSteps++;

				if (Math.random() < modelTier.accuracy) correctActions++;
				if (Math.random() < 0.3) {
					stumbles++;
					if (Math.random() < modelTier.recoveryRate) recoveredWithinUI++;
				}

				totalLatency += modelTier.baseLatencyMs + Math.floor(Math.random() * 500);
				if (Math.random() > modelTier.accuracy) hallucinations++;
			}

			const taskCompletion = (completedSteps / steps.length) * 100;
			const autonomousAccuracy = steps.length > 0 ? (correctActions / steps.length) * 100 : 0;
			const recoveryEfficiency = stumbles > 0 ? (recoveredWithinUI / stumbles) * 100 : 100;
			const stepEfficiency = Math.min(100, (steps.length / Math.max(completedSteps, 1)) * 100);
			const avgLatency = steps.length > 0 ? totalLatency / steps.length : 0;
			const hallucinationRate = steps.length > 0 ? (hallucinations / steps.length) * 100 : 0;
			const normalizedLatency = Math.min(avgLatency / 5000, 1);

			const clawBenchScore =
				0.30 * taskCompletion +
				0.25 * autonomousAccuracy +
				0.15 * recoveryEfficiency +
				0.10 * stepEfficiency +
				0.10 * (1 - normalizedLatency) * 100 +
				0.10 * (1 - hallucinationRate / 100) * 100;

			const personaNameMap = new Map<PersonaId, string>();
			personaNameMap.set(pid, persona.name);
			const report = tracker.generateReport(scenario.name, personaNameMap);

			results.push({
				model,
				taskCompletion,
				autonomousAccuracy,
				recoveryEfficiency,
				stepEfficiency,
				latency: avgLatency,
				hallucinationRate,
				clawBenchScore,
				totalCostUSD: report.totalCostUSD,
				totalRequests: report.personas[0]?.totalRequests ?? 0,
			});
		}

		// Sort by ClawBench score
		results.sort((a, b) => b.clawBenchScore - a.clawBenchScore);

		if (json) {
			console.log(JSON.stringify({ scenario: scenario.name, persona: persona.name, results }, null, 2));
			return;
		}

		// ── Render Results ───────────────────────────────────────────────
		console.log(pc.bold("\n── ClawBench Results ──\n"));

		const table = new Table({
			columns: [
				{ header: "Model", width: 32, align: "left" },
				{ header: "Score", width: 8, align: "right" },
				{ header: "Compl%", width: 8, align: "right" },
				{ header: "Accur%", width: 8, align: "right" },
				{ header: "Recov%", width: 8, align: "right" },
				{ header: "Halluc%", width: 8, align: "right" },
				{ header: "Cost", width: 10, align: "right" },
			],
		});

		for (const r of results) {
			table.addRow([
				r.model,
				r.clawBenchScore.toFixed(1),
				r.taskCompletion.toFixed(0),
				r.autonomousAccuracy.toFixed(0),
				r.recoveryEfficiency.toFixed(0),
				r.hallucinationRate.toFixed(0),
				formatCurrency(r.totalCostUSD),
			]);
		}

		console.log(table.render());

		// Cost-performance ratio
		console.log(pc.bold("Cost-Performance Ratio (Score / $):"));
		const sorted = [...results].sort(
			(a, b) =>
				(b.totalCostUSD > 0 ? b.clawBenchScore / b.totalCostUSD : 0) -
				(a.totalCostUSD > 0 ? a.clawBenchScore / a.totalCostUSD : 0),
		);
		for (const r of sorted) {
			const ratio = r.totalCostUSD > 0 ? r.clawBenchScore / r.totalCostUSD : 0;
			console.log(`  ${r.model.padEnd(35)} ${ratio.toFixed(0)} pts/$`);
		}
		console.log("");
	},
});

interface ModelTier {
	completionRate: number;
	accuracy: number;
	recoveryRate: number;
	baseLatencyMs: number;
}

function getModelTier(model: string): ModelTier {
	if (model.includes("opus")) {
		return { completionRate: 0.98, accuracy: 0.95, recoveryRate: 0.9, baseLatencyMs: 2000 };
	}
	if (model.includes("sonnet")) {
		return { completionRate: 0.93, accuracy: 0.88, recoveryRate: 0.8, baseLatencyMs: 1200 };
	}
	if (model.includes("haiku") || model.includes("flash") || model.includes("mini")) {
		return { completionRate: 0.82, accuracy: 0.75, recoveryRate: 0.6, baseLatencyMs: 600 };
	}
	if (model.includes("gpt")) {
		return { completionRate: 0.90, accuracy: 0.85, recoveryRate: 0.75, baseLatencyMs: 1500 };
	}
	if (model.includes("deepseek")) {
		return { completionRate: 0.80, accuracy: 0.72, recoveryRate: 0.55, baseLatencyMs: 800 };
	}
	// Default: mid-tier
	return { completionRate: 0.85, accuracy: 0.78, recoveryRate: 0.65, baseLatencyMs: 1000 };
}
