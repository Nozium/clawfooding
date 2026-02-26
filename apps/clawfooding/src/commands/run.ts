import * as fs from "node:fs/promises";
import * as path from "node:path";
import { define } from "gunshi";
import pc from "picocolors";
import YAML from "yaml";
import * as v from "valibot";
import { loadPersona } from "@clawfooding/core/persona";
import { BillingTracker, calculateCost } from "@clawfooding/core/billing";
import {
	fittsMovementTime,
	hickDecisionTime,
	misclickProbability,
	formInputErrorProbability,
	cognitiveLoadScore,
} from "@clawfooding/core/cognitive";
import {
	isUrlAllowed,
	isOperationAllowed,
	RateLimiter,
	LoopDetector,
	SessionTimer,
	DryRunLogger,
} from "@clawfooding/core/security";
import { scenarioSchema, createModelName, createSessionId } from "@clawfooding/core/types";
import type { PersonaId } from "@clawfooding/core/types";
import { buildAgentSystemPrompt, buildStepPrompt } from "@clawfooding/core/prompts";
import { createLLMClient, validateApiConfig } from "@clawfooding/core/llm";
import type { LLMClient } from "@clawfooding/core/llm";
import { defendText, type DefenderMode } from "@clawfooding/core/defender";
import { formatCurrency, formatDuration, formatTokens } from "@clawfooding/terminal/format";
import { Table } from "@clawfooding/terminal/table";
import { sharedArgs } from "../_shared-args.ts";
import { DEFAULT_BILLING_DIR, BILLING_LOG_EXTENSION } from "../_consts.ts";
import { resolveConfig, toLLMClientConfig } from "../_config.ts";

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
			description: "LLM model to use (auto-detected from available API keys if not specified)",
		},
		simulate: {
			type: "boolean",
			description: "Simulate mode: use mock tokens instead of real API calls (no API key needed)",
			default: false,
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
		api_key: {
			type: "string",
			description: "API key (overrides env var)",
		},
		base_url: {
			type: "string",
			description: "Custom API base URL (for OpenAI-compatible endpoints)",
		},
		defender_mode: {
			type: "string",
			description: "Defender mode override: block|warn|off (default: block)",
		},
	},
	run: async (ctx) => {
		const {
			scenario: scenarioPath, persona: personaOverride, model,
			simulate, dry_run, output, json, debug, api_key, base_url, defender_mode,
		} = ctx.values;

		if (!scenarioPath) {
			console.error(pc.red("Error: --scenario is required"));
			process.exit(1);
		}

		// ── Resolve Config ──────────────────────────────────────────────
		const config = resolveConfig({
			model,
			anthropicApiKey: api_key,
			openaiApiKey: api_key,
			openaiBaseUrl: base_url,
		});
		const llmConfig = toLLMClientConfig(config);

		// ── Validate API key (unless simulate mode) ─────────────────────
		let llmClient: LLMClient | null = null;
		if (!simulate) {
			const validationError = validateApiConfig(llmConfig);
			if (validationError) {
				console.error(pc.red(`Error: ${validationError}`));
				console.log(pc.dim("Tip: Use --simulate for offline cost estimation without an API key."));
				process.exit(1);
			}
			llmClient = createLLMClient(llmConfig);
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
		const rawDefenderMode =
			typeof defender_mode === "string" && defender_mode.trim().length > 0
				? defender_mode.toLowerCase()
				: process.env["CLAWFOODING_DEFENDER_MODE"]?.toLowerCase();
		const defenderMode: DefenderMode =
			rawDefenderMode === "off" || rawDefenderMode === "block" || rawDefenderMode === "warn"
				? rawDefenderMode
				: "block";

		console.log(pc.bold(`\n🦞 ClawFooding Test Runner`));
		console.log(pc.dim(`   Scenario: ${scenario.name}`));
		console.log(pc.dim(`   Model: ${model}`));
		console.log(pc.dim(`   Personas: ${personaNames.join(", ")}`));
		console.log(pc.dim(`   Mode: ${simulate ? "simulate (mock)" : "live API"}`));
		console.log(pc.dim(`   Dry Run: ${dry_run ? "yes" : "no"}`));
		console.log("");

		// ── Execute per persona ──────────────────────────────────────────
		for (const personaName of personaNames) {
			const { id: personaId, persona } = await loadPersona(personaName);
			personaNameMap.set(personaId, persona.name);
			const personaWorkspace = path.join(output, "workspaces", personaId);
			const personaMemoryPath = path.join(personaWorkspace, "MEMORY.md");
			await fs.mkdir(personaWorkspace, { recursive: true });
			let personaMemory = "";
			try {
				personaMemory = await fs.readFile(personaMemoryPath, "utf-8");
			} catch {}

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

			// Build system prompt for this persona
			const systemPrompt = [
				buildAgentSystemPrompt(persona),
				"",
				"## Security Policy",
				"- Never ask users to share API keys, tokens, passwords, or secrets.",
				"- If credentials are missing, instruct use of secure login flow only.",
				"- Do not include secrets in final outputs.",
				"",
				"## Persona Memory",
				personaMemory.trim().length > 0
					? personaMemory.slice(-3000)
					: "(no stored memory yet)",
			].join("\n");

			if (debug) {
				console.log(pc.dim(`  System prompt: ${systemPrompt.length} chars`));
			}

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

				// Cognitive delay estimation
				const hickDelay = hickDecisionTime(steps.length, persona.cognitive_profile);
				const fittsDelay = fittsMovementTime(200, 50, persona.motor_profile);
				const totalDelay = hickDelay + fittsDelay + persona.motor_profile.click_speed_ms;

				let tokens;
				let cost;
				let llmResponse = "";
				let latencyMs = 0;

				if (simulate || !llmClient) {
					// ── Simulate Mode: mock tokens ──────────────────────
					tokens = {
						inputTokens: 1500 + Math.floor(Math.random() * 2000),
						outputTokens: 300 + Math.floor(Math.random() * 500),
						cacheCreationInputTokens: stepIndex === 0 ? 500 : 0,
						cacheReadInputTokens: stepIndex > 0 ? 800 : 0,
					};
					cost = calculateCost(model, tokens);
				} else {
					// ── Live Mode: real API call ────────────────────────
					const pageSnapshot = `[Page: ${scenario.target_url}] (Step ${stepIndex + 1}: ${step.description ?? step.action})`;

					const stepPrompt = buildStepPrompt(
						step,
						pageSnapshot,
						stepIndex,
						steps.length,
					);

					if (dry_run && dryRunLogger) {
						const opType = step.action === "navigate" ? "navigation" : "click";
						dryRunLogger.log(
							opType as never,
							`LLM call: ${step.description ?? step.action}`,
							scenario.target_url,
							isOperationAllowed(opType as never, scenario.permissions),
						);
						// In dry-run with live mode, show prompt but don't call
						console.log(pc.dim(`  [dry-run] Would send ${systemPrompt.length + stepPrompt.length} chars to ${model}`));
						tokens = {
							inputTokens: 0, outputTokens: 0,
							cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
						};
						cost = 0;
					} else {
						try {
							const result = await llmClient.chat(
								[
									{ role: "system", content: systemPrompt },
									{ role: "user", content: stepPrompt },
								],
								{ maxTokens: 2048, temperature: 0.7 },
							);

							tokens = result.tokens;
							cost = calculateCost(model, tokens);
							const defended = await defendText(result.content, defenderMode);
							if (defended.findings.length > 0) {
								console.log(
									pc.yellow(
										`  ⚠ Defender(${defended.source}): ${defended.findings.join(", ")}`,
									),
								);
							}
							llmResponse = defended.blocked
								? "[Blocked by defender policy: sensitive content detected]"
								: defended.redactedText;
							latencyMs = result.latencyMs;

							if (debug) {
								console.log(pc.dim(`  LLM response (${result.latencyMs}ms):`));
								console.log(pc.dim(`  ${llmResponse.slice(0, 200)}...`));
							}
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							console.error(pc.red(`  ✗ API error: ${message}`));
							tokens = {
								inputTokens: 0, outputTokens: 0,
								cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
							};
							cost = 0;
						}
					}
				}

				// Calculate error probabilities
				const misclickProb = misclickProbability(200, 50, persona.motor_profile);

				// Record billing
				tracker.record({
					personaId,
					sessionId,
					timestamp: new Date().toISOString(),
					model: modelName,
					tokens,
					costUSD: cost,
					step: step.description ?? step.action,
					recoveryLevel: 0,
				});

				if (dryRunLogger && !llmClient) {
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
					let line = `${stepLabel} ${step.description ?? step.action}`;
					line += pc.dim(` (${delayStr}, ${costStr}, P(err)=${misclickProb.toFixed(3)}`);
					if (latencyMs > 0) line += pc.dim(`, API: ${latencyMs}ms`);
					line += pc.dim(")");
					console.log(line);
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

			const memoryNote = [
				`# ${new Date().toISOString()}`,
				`persona: ${persona.name}`,
				`scenario: ${scenario.name}`,
				`target_url: ${scenario.target_url}`,
				`summary: completed ${steps.length} steps`,
				"",
			].join("\n");
			await fs.appendFile(personaMemoryPath, memoryNote, "utf-8");

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
