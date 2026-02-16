import * as fs from "node:fs/promises";
import * as path from "node:path";
import { define } from "gunshi";
import pc from "picocolors";
import YAML from "yaml";
import * as v from "valibot";
import { loadPersona, generateSoulMd } from "@clawfooding/core/persona";
import { BillingTracker, calculateCost } from "@clawfooding/core/billing";
import {
	fittsMovementTime,
	hickDecisionTime,
	misclickProbability,
	formInputErrorProbability,
	cognitiveLoadScore,
	abandonmentProbability,
} from "@clawfooding/core/cognitive";
import {
	isUrlAllowed,
	isOperationAllowed,
	RateLimiter,
	LoopDetector,
	SessionTimer,
	DryRunLogger,
} from "@clawfooding/core/security";
import { scenarioSchema, createPersonaId, createModelName, createSessionId } from "@clawfooding/core/types";
import type { PersonaId, Scenario, Persona, Permissions } from "@clawfooding/core/types";
import { formatCurrency, formatDuration, formatTokens } from "@clawfooding/terminal/format";
import { Table, renderSummary } from "@clawfooding/terminal/table";
import { sharedArgs } from "../_shared-args.ts";
import { DEFAULT_BILLING_DIR, BILLING_LOG_EXTENSION } from "../_consts.ts";

export const runCommandDef = define({
	args: {
		...sharedArgs,
		scenario: {
			type: "string",
			short: "s",
			description: "Path to scenario YAML file",
			required: true,
		},
		persona: {
			type: "string",
			short: "p",
			description: "Persona name or path (overrides scenario personas list)",
		},
		model: {
			type: "string",
			short: "m",
			description: "LLM model to use (e.g., anthropic/claude-sonnet-4-5)",
			default: "anthropic/claude-sonnet-4-5",
		},
		dry_run: {
			type: "boolean",
			description: "Dry run mode: log operations without executing writes",
			default: false,
		},
		output: {
			type: "string",
			short: "o",
			description: "Output directory for billing logs and reports",
			default: DEFAULT_BILLING_DIR,
		},
	},
	run: async (ctx) => {
		const { scenario: scenarioPath, persona: personaOverride, model, dry_run, output, json, debug } = ctx.values;

		if (!scenarioPath) {
			console.error(pc.red("Error: --scenario is required"));
			process.exit(1);
		}

		// ── Load Scenario ────────────────────────────────────────────────
		const scenarioRaw = await fs.readFile(scenarioPath, "utf-8");
		const scenarioParsed = YAML.parse(scenarioRaw) as unknown;
		const scenario = v.parse(scenarioSchema, scenarioParsed);

		if (debug) {
			console.log(pc.dim(`Loaded scenario: ${scenario.name}`));
			console.log(pc.dim(`Target URL: ${scenario.target_url}`));
		}

		// ── Determine Personas ───────────────────────────────────────────
		const personaNames = personaOverride
			? [personaOverride]
			: scenario.personas;

		if (personaNames.length === 0) {
			console.error(pc.red("Error: No personas specified in scenario or via --persona"));
			process.exit(1);
		}

		// ── Initialize Billing Tracker ───────────────────────────────────
		const tracker = new BillingTracker();
		const personaNameMap = new Map<PersonaId, string>();
		const modelName = createModelName(model);

		console.log(pc.bold(`\n🦞 ClawFooding Test Runner`));
		console.log(pc.dim(`   Scenario: ${scenario.name}`));
		console.log(pc.dim(`   Model: ${model}`));
		console.log(pc.dim(`   Personas: ${personaNames.join(", ")}`));
		console.log(pc.dim(`   Dry Run: ${dry_run ? "yes" : "no"}`));
		console.log("");

		// ── Execute per persona ──────────────────────────────────────────
		for (const personaName of personaNames) {
			const { id: personaId, persona } = await loadPersona(personaName);
			personaNameMap.set(personaId, persona.name);

			console.log(pc.bold(`── Persona: ${persona.name} ──`));

			// Security setup
			const rateLimiter = new RateLimiter(scenario.permissions.max_requests_per_minute);
			const loopDetector = new LoopDetector();
			const sessionTimer = new SessionTimer(scenario.permissions.max_session_duration);
			const dryRunLogger = dry_run ? new DryRunLogger() : null;

			// URL validation
			if (!isUrlAllowed(scenario.target_url, scenario.permissions)) {
				console.error(pc.red(`  URL not in allowlist: ${scenario.target_url}`));
				continue;
			}

			const sessionId = createSessionId(
				`${personaId}-${Date.now()}`,
			);

			// ── Simulate Cognitive Test Steps ────────────────────────────
			const steps = scenario.steps ?? [
				{ action: "navigate", description: "Navigate to target URL" },
				{ action: "scan", description: "Visual scan of page elements" },
				{ action: "interact", description: "Interact with primary elements" },
			];

			for (const [stepIndex, step] of steps.entries()) {
				if (sessionTimer.isExpired) {
					console.log(pc.yellow(`  ⏰ Session timeout reached`));
					break;
				}

				if (!rateLimiter.tryRequest()) {
					console.log(pc.yellow(`  ⚠ Rate limit reached, waiting...`));
					await new Promise((resolve) => setTimeout(resolve, 2000));
					if (!rateLimiter.tryRequest()) {
						console.log(pc.red(`  ✗ Rate limit exceeded, skipping step`));
						continue;
					}
				}

				const loopStatus = loopDetector.record(step.action, step.description ?? "");
				if (loopStatus === "stop") {
					console.log(pc.red(`  🔄 Loop detected, stopping persona execution`));
					break;
				}
				if (loopStatus === "warn") {
					console.log(pc.yellow(`  ⚠ Possible loop detected for: ${step.action}`));
				}

				// Simulate cognitive delay based on persona
				const hickDelay = hickDecisionTime(
					steps.length,
					persona.cognitive_profile,
				);
				const fittsDelay = fittsMovementTime(
					200, // Approximate distance
					50,  // Approximate target width
					persona.motor_profile,
				);
				const totalDelay = hickDelay + fittsDelay + persona.motor_profile.click_speed_ms;

				// Simulate API call for this step (cognitive agent decision)
				const simulatedTokens = {
					inputTokens: 1500 + Math.floor(Math.random() * 2000),
					outputTokens: 300 + Math.floor(Math.random() * 500),
					cacheCreationInputTokens: stepIndex === 0 ? 500 : 0,
					cacheReadInputTokens: stepIndex > 0 ? 800 : 0,
				};

				const cost = calculateCost(model, simulatedTokens);

				// Calculate error probabilities for this step
				const misclickProb = misclickProbability(200, 50, persona.motor_profile);
				const formErrorProb = formInputErrorProbability(
					step.action === "interact" ? 5 : 0,
					persona.cognitive_profile,
				);

				// Record billing
				tracker.record({
					personaId,
					sessionId,
					timestamp: new Date().toISOString(),
					model: modelName,
					tokens: simulatedTokens,
					costUSD: cost,
					step: step.description ?? step.action,
					recoveryLevel: 0,
				});

				if (dryRunLogger) {
					const opType = step.action === "navigate" ? "navigation" : "click";
					dryRunLogger.log(
						opType as never,
						step.description ?? step.action,
						scenario.target_url,
						isOperationAllowed(opType as never, scenario.permissions),
					);
				}

				// Output step result
				const stepLabel = `  [${stepIndex + 1}/${steps.length}]`;
				const costStr = formatCurrency(cost);
				const delayStr = formatDuration(totalDelay);

				if (!json) {
					console.log(
						`${stepLabel} ${step.description ?? step.action}` +
						pc.dim(` (${delayStr}, ${costStr}, P(err)=${misclickProb.toFixed(3)})`)
					);
				}
			}

			// Cognitive load summary for this persona
			const loadScore = cognitiveLoadScore(
				steps.length,
				steps.filter((s) => s.action === "interact").length,
				steps.length * 5,
				390 * 844,
			);

			if (!json) {
				console.log(pc.dim(`  Cognitive Load: ${loadScore}/100`));
				console.log(pc.dim(`  Session: ${sessionTimer.elapsedSeconds}s elapsed`));
				console.log("");
			}

			// Save dry run log if applicable
			if (dryRunLogger) {
				const dryRunPath = path.join(output, `dry-run-${personaId}.json`);
				await fs.mkdir(path.dirname(dryRunPath), { recursive: true });
				await fs.writeFile(dryRunPath, dryRunLogger.toJson(), "utf-8");
				console.log(pc.dim(`  Dry run log: ${dryRunPath}`));
			}
		}

		// ── Generate Report ──────────────────────────────────────────────
		const report = tracker.generateReport(scenario.name, personaNameMap);

		if (json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			printBillingReport(report);
		}

		// ── Persist billing logs ─────────────────────────────────────────
		await fs.mkdir(output, { recursive: true });
		const logPath = path.join(
			output,
			`${scenario.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}${BILLING_LOG_EXTENSION}`,
		);
		await fs.writeFile(logPath, tracker.exportJsonl(), "utf-8");
		console.log(pc.dim(`Billing log saved: ${logPath}`));
	},
});

function printBillingReport(report: import("@clawfooding/core/types").BillingReport): void {
	console.log(pc.bold("\n── Per-Persona Billing Report ──\n"));

	// Summary table
	const table = new Table({
		title: "Cost by Persona",
		columns: [
			{ header: "Persona", width: 25, align: "left" },
			{ header: "Requests", width: 10, align: "right" },
			{ header: "Input Tok", width: 12, align: "right" },
			{ header: "Output Tok", width: 12, align: "right" },
			{ header: "Cost", width: 12, align: "right" },
			{ header: "Share", width: 8, align: "right" },
		],
	});

	for (const persona of report.personas) {
		const share = report.costPerPersonaComparison.find(
			(c) => c.personaId === persona.personaId,
		);
		table.addRow([
			persona.personaName,
			String(persona.totalRequests),
			formatTokens(persona.totalTokens.inputTokens),
			formatTokens(persona.totalTokens.outputTokens),
			formatCurrency(persona.totalCostUSD),
			share ? `${share.percentage.toFixed(1)}%` : "—",
		]);
	}

	table.addSeparator();
	table.addRow([
		pc.bold("TOTAL"),
		String(report.personas.reduce((s, p) => s + p.totalRequests, 0)),
		formatTokens(
			report.personas.reduce((s, p) => s + p.totalTokens.inputTokens, 0),
		),
		formatTokens(
			report.personas.reduce((s, p) => s + p.totalTokens.outputTokens, 0),
		),
		pc.bold(formatCurrency(report.totalCostUSD)),
		"100%",
	]);

	console.log(table.render());

	// Model breakdown
	if (report.modelTotals.length > 0) {
		const modelTable = new Table({
			title: "Cost by Model",
			columns: [
				{ header: "Model", width: 35, align: "left" },
				{ header: "Requests", width: 10, align: "right" },
				{ header: "Cost", width: 12, align: "right" },
			],
		});

		for (const model of report.modelTotals) {
			modelTable.addRow([
				String(model.model),
				String(model.requestCount),
				formatCurrency(model.costUSD),
			]);
		}

		console.log(modelTable.render());
	}

	// Recovery cost analysis
	const recoveryPersonas = report.personas.filter((p) => p.recoveryCost > 0);
	if (recoveryPersonas.length > 0) {
		console.log(pc.bold("Recovery Costs:"));
		for (const p of recoveryPersonas) {
			console.log(
				`  ${p.personaName}: ${formatCurrency(p.recoveryCost)} ` +
				pc.dim(`(${((p.recoveryCost / p.totalCostUSD) * 100).toFixed(1)}% of persona total)`),
			);
		}
		console.log("");
	}
}
