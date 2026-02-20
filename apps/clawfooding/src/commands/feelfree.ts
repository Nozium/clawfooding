/// <reference path="../_playwright.d.ts" />

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { define } from "gunshi";
import pc from "picocolors";
import { loadPersona } from "@clawfooding/core/persona";
import { createModelName } from "@clawfooding/core/types";
import type { Persona, PersonaId } from "@clawfooding/core/types";
import { buildAgentSystemPrompt } from "@clawfooding/core/prompts";
import { createLLMClient, validateApiConfig } from "@clawfooding/core/llm";
import { defendText, type DefenderMode } from "@clawfooding/core/defender";
import { sharedArgs } from "../_shared-args.ts";
import { resolveConfig, toLLMClientConfig } from "../_config.ts";

type SearchHit = {
	query: string;
	title: string;
	url: string;
	snippet: string;
};

type PersonaReport = {
	personaId: PersonaId;
	personaName: string;
	goal: string;
	searchQueries: string[];
	hits: SearchHit[];
	summary: string;
	defender: {
		mode: DefenderMode;
		source: string;
		findings: string[];
		blocked: boolean;
	};
};

function resolveDefenderMode(raw: unknown): DefenderMode {
	const value = typeof raw === "string" ? raw.toLowerCase() : "";
	if (value === "off" || value === "warn" || value === "block") return value;
	return "block";
}

function buildPersonaQueries(goal: string, persona: Persona): string[] {
	const motivation = persona.context.motivation;
	const device = persona.demographics.device;
	return [
		`${goal} trends ${motivation}`,
		`${goal} latest news ${persona.context.environment}`,
		`${goal} recommended services for ${device}`,
	];
}

function summarizeFromHitsFallback(persona: Persona, goal: string, hits: SearchHit[]): string {
	const top = hits.slice(0, 9);
	const trend = top.slice(0, 3).map((h) => `- ${h.title} (${h.url})`).join("\n");
	const news = top.slice(3, 6).map((h) => `- ${h.title} (${h.url})`).join("\n");
	const services = top.slice(6, 9).map((h) => `- ${h.title} (${h.url})`).join("\n");
	return [
		`Persona: ${persona.name}`,
		`Goal: ${goal}`,
		"",
		"Trends:",
		trend || "- (no data)",
		"",
		"Notable News:",
		news || "- (no data)",
		"",
		"Services to Check:",
		services || "- (no data)",
	].join("\n");
}

async function ensurePlaywrightChromium(): Promise<{
	browser: { newPage: () => Promise<any>; close: () => Promise<void> };
}> {
	let mod: Record<string, unknown>;
	try {
		mod = (await import("playwright")) as unknown as Record<string, unknown>;
	} catch {
		throw new Error(
			'Playwright is required for real browser mode. Install it in this environment and retry (e.g. "pnpm add -D playwright").',
		);
	}
	const chromium = mod["chromium"] as { launch: (opts: { headless: boolean }) => Promise<any> } | undefined;
	if (!chromium || typeof chromium.launch !== "function") {
		throw new Error("Playwright chromium launcher is unavailable.");
	}
	const browser = await chromium.launch({ headless: true });
	return { browser };
}

async function googleSearch(browser: { newPage: () => Promise<any> }, query: string): Promise<SearchHit[]> {
	const page = await browser.newPage();
	try {
		const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`;
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.waitForTimeout(1500);
		const hits = (await page.evaluate((q: string) => {
			const cards = Array.from(document.querySelectorAll("div#search .g"));
			const out: Array<{ query: string; title: string; url: string; snippet: string }> = [];
			for (const card of cards) {
				const link = card.querySelector("a");
				const titleEl = card.querySelector("h3");
				const snippetEl =
					card.querySelector("div.VwiC3b") ??
					card.querySelector("span.aCOpRe") ??
					card.querySelector("div[data-sncf]");
				const title = (titleEl?.textContent ?? "").trim();
				const href = (link?.getAttribute("href") ?? "").trim();
				const snippet = (snippetEl?.textContent ?? "").trim();
				if (!title || !href) continue;
				out.push({ query: q, title, url: href, snippet });
				if (out.length >= 5) break;
			}
			return out;
		}, query)) as SearchHit[];
		return hits;
	} finally {
		await page.close();
	}
}

export const feelfreeCommandDef = define({
	args: {
		...sharedArgs,
		url: {
			type: "string",
			description: "Target URL to start research from (e.g., https://www.google.com)",
			required: true,
		},
		goal: {
			type: "string",
			description: "Research goal (e.g., AI developer tools in Japan)",
			required: true,
		},
		personas: {
			type: "string",
			description: "Comma-separated persona names (default: haruka,kenji,yuki)",
			default: "haruka,kenji,yuki",
		},
		model: {
			type: "string",
			short: "m",
			description: "LLM model for persona report synthesis (auto-detected from available API keys if not specified)",
		},
		simulate: {
			type: "boolean",
			description: "Skip live browser/LLM and use mock output",
			default: false,
		},
		output: {
			type: "string",
			short: "o",
			description: "Output directory for persona workspaces and reports",
			default: ".clawfooding/feelfree",
		},
		defender_mode: {
			type: "string",
			description: "Defender mode override: block|warn|off (default: block)",
		},
	},
	run: async (ctx) => {
		const { url, goal, personas, model, simulate, output, json, defender_mode } = ctx.values;
		const personaNames = String(personas)
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean);

		const config = resolveConfig({ model });
		const llmConfig = toLLMClientConfig(config);
		const rawDefenderMode =
			typeof defender_mode === "string" && defender_mode.trim().length > 0
				? defender_mode
				: process.env["CLAWFOODING_DEFENDER_MODE"];
		const defenderMode = resolveDefenderMode(rawDefenderMode);

		if (!simulate) {
			const validationError = validateApiConfig(llmConfig);
			if (validationError) {
				console.error(pc.red(`Error: ${validationError}`));
				process.exit(1);
			}
		}

		await fs.mkdir(output, { recursive: true });
		const llmClient = !simulate ? createLLMClient(llmConfig) : null;
		const reports: PersonaReport[] = [];

		let browserWrap: { browser: { newPage: () => Promise<any>; close: () => Promise<void> } } | null = null;
		if (!simulate) {
			browserWrap = await ensurePlaywrightChromium();
		}

		try {
			for (const personaName of personaNames) {
				const { id: personaId, persona } = await loadPersona(personaName);
				const workspaceDir = path.join(output, "workspaces", personaId);
				const memoryPath = path.join(workspaceDir, "MEMORY.md");
				await fs.mkdir(workspaceDir, { recursive: true });
				let memory = "";
				try {
					memory = await fs.readFile(memoryPath, "utf-8");
				} catch {}

				const queries = buildPersonaQueries(goal, persona);
				let hits: SearchHit[] = [];
				if (simulate || !browserWrap) {
					hits = queries.flatMap((q, idx) => [
						{
							query: q,
							title: `[mock] trend sample ${idx + 1}`,
							url: `${url}/mock/trend-${idx + 1}`,
							snippet: "mock snippet",
						},
					]);
				} else {
					for (const q of queries) {
						const result = await googleSearch(browserWrap.browser, q);
						hits.push(...result);
					}
				}

				let summary = summarizeFromHitsFallback(persona, goal, hits);
				if (llmClient) {
					const systemPrompt = [
						buildAgentSystemPrompt(persona),
						"",
						"You are preparing a dogfooding research report.",
						"Never ask the user to provide API keys or secrets.",
						"Return concise sections: Trends, Notable News, Services.",
						"Use only provided evidence URLs.",
						"",
						"Persona memory:",
						memory.trim().length > 0 ? memory.slice(-2500) : "(empty)",
					].join("\n");

					const userPrompt = [
						`Target URL: ${url}`,
						`Goal: ${goal}`,
						"",
						"Evidence (Google search results):",
						JSON.stringify(hits, null, 2),
						"",
						"Create a persona-specific report with:",
						"1) Top trends (3)",
						"2) Notable news (3)",
						"3) Services worth trying (3) + why for this persona",
					].join("\n");

					const result = await llmClient.chat(
						[
							{ role: "system", content: systemPrompt },
							{ role: "user", content: userPrompt },
						],
						{ maxTokens: 1400, temperature: 0.6 },
					);
					summary = result.content;
				}

				const defended = await defendText(summary, defenderMode);
				const safeSummary = defended.blocked
					? "[Blocked by defender policy: sensitive content detected]"
					: defended.redactedText;

				const memoryEntry = [
					`# ${new Date().toISOString()}`,
					`goal: ${goal}`,
					`queries: ${queries.join(" | ")}`,
					`hits: ${hits.length}`,
					`summary_head: ${safeSummary.slice(0, 220).replace(/\s+/g, " ")}`,
					"",
				].join("\n");
				await fs.appendFile(memoryPath, memoryEntry, "utf-8");

				const report: PersonaReport = {
					personaId,
					personaName: persona.name,
					goal,
					searchQueries: queries,
					hits,
					summary: safeSummary,
					defender: {
						mode: defenderMode,
						source: defended.source,
						findings: defended.findings,
						blocked: defended.blocked,
					},
				};
				reports.push(report);

				if (!json) {
					console.log(pc.bold(`\n── ${persona.name} ──`));
					if (defended.findings.length > 0) {
						console.log(pc.yellow(`Defender: ${defended.findings.join(", ")}`));
					}
					console.log(safeSummary);
				}
			}
		} finally {
			if (browserWrap) {
				await browserWrap.browser.close();
			}
		}

		const modelSlug = config.model.replace(/\//g, "-");
		const outPath = path.join(output, `${modelSlug}-report-${Date.now()}.json`);
		await fs.writeFile(outPath, JSON.stringify({
			generatedAt: new Date().toISOString(),
			targetUrl: url,
			goal,
			model: config.model,
			defenderMode,
			reports,
		}, null, 2), "utf-8");

		if (json) {
			console.log(JSON.stringify({ output: outPath, reports }, null, 2));
		} else {
			console.log(pc.dim(`\nSaved feelfree report: ${outPath}`));
		}
	},
});

