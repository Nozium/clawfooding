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

type PageData = {
	hits: SearchHit[];
	links: Array<{ text: string; href: string }>;
};

type PersonaReport = {
	personaId: PersonaId;
	personaName: string;
	goal: string;
	visitedUrls: string[];
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
		// Use createRequire so NODE_PATH (set by Nix wrapper) is respected.
		// ESM dynamic import() ignores NODE_PATH; CJS require() does not.
		const { createRequire } = await import("node:module");
		const req = createRequire(import.meta.url);
		mod = req("playwright") as unknown as Record<string, unknown>;
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

async function scrapePage(browser: { newPage: () => Promise<any> }, targetUrl: string, goal: string): Promise<PageData> {
	const page = await browser.newPage();
	try {
		await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
		await page.waitForTimeout(800);
		return (await page.evaluate((args: { url: string; goal: string }) => {
			const hits: Array<{ query: string; title: string; url: string; snippet: string }> = [];
			const links: Array<{ text: string; href: string }> = [];
			const pageTitle = (document.querySelector("h1")?.textContent ?? document.title ?? "").trim();

			// Content: headings + nearby text
			for (const h of Array.from(document.querySelectorAll("h1, h2, h3"))) {
				const title = (h.textContent ?? "").trim();
				if (!title) continue;
				const snippet = ((h.nextElementSibling?.textContent ?? "")).trim().slice(0, 200);
				hits.push({ query: args.goal, title, url: args.url, snippet });
				if (hits.length >= 9) break;
			}
			if (hits.length === 0) {
				for (const p of Array.from(document.querySelectorAll("p"))) {
					const text = (p.textContent ?? "").trim();
					if (text.length < 20) continue;
					hits.push({ query: args.goal, title: pageTitle, url: args.url, snippet: text.slice(0, 200) });
					if (hits.length >= 9) break;
				}
			}

			// Links (absolute URLs only, deduplicated)
			const seen = new Set<string>();
			for (const a of Array.from(document.querySelectorAll("a[href]"))) {
				const href = (a as HTMLAnchorElement).href;
				const text = (a.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
				if (!href.startsWith("http") || !text || seen.has(href) || href === args.url) continue;
				seen.add(href);
				links.push({ text, href });
				if (links.length >= 20) break;
			}

			return { hits, links };
		}, { url: targetUrl, goal })) as PageData;
	} finally {
		await page.close();
	}
}

async function chooseNextLink(
	llmClient: { chat: (messages: any[], opts: any) => Promise<{ content: string }> },
	persona: Persona,
	goal: string,
	currentUrl: string,
	links: Array<{ text: string; href: string }>,
	visited: string[],
): Promise<string | null> {
	const candidates = links.filter((l) => !visited.includes(l.href)).slice(0, 15);
	if (candidates.length === 0) return null;

	const linkList = candidates.map((l, i) => `${i + 1}. "${l.text}" → ${l.href}`).join("\n");
	const prompt = [
		`You are ${persona.name}. ${persona.context.motivation}`,
		`Goal: ${goal}`,
		`Current page: ${currentUrl}`,
		"",
		"Links available:",
		linkList,
		"",
		`Which link number is most relevant to your goal? Reply ONLY with the number (e.g. "3") or "DONE" if no link is relevant.`,
	].join("\n");

	const result = await llmClient.chat([{ role: "user", content: prompt }], { maxTokens: 10 });
	const text = result.content.trim();
	if (text.toUpperCase().startsWith("DONE")) return null;
	const idx = parseInt(text, 10) - 1;
	return candidates[idx]?.href ?? null;
}

async function browseWithPersona(
	browser: { newPage: () => Promise<any> },
	llmClient: { chat: (messages: any[], opts: any) => Promise<{ content: string }> } | null,
	startUrl: string,
	goal: string,
	persona: Persona,
	maxSteps: number,
): Promise<{ hits: SearchHit[]; visitedUrls: string[] }> {
	let currentUrl = startUrl;
	const visited: string[] = [];
	const allHits: SearchHit[] = [];

	for (let step = 0; step < maxSteps; step++) {
		if (visited.includes(currentUrl)) break;
		visited.push(currentUrl);

		const { hits, links } = await scrapePage(browser, currentUrl, goal);
		allHits.push(...hits);

		if (!llmClient || step === maxSteps - 1 || links.length === 0) break;

		const nextUrl = await chooseNextLink(llmClient, persona, goal, currentUrl, links, visited);
		if (!nextUrl) break;
		currentUrl = nextUrl;
	}

	return { hits: allHits, visitedUrls: visited };
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
		steps: {
			type: "number",
			description: "Max pages to visit per persona when browsing (default: 3)",
			default: 3,
		},
		defender_mode: {
			type: "string",
			description: "Defender mode override: block|warn|off (default: block)",
		},
	},
	run: async (ctx) => {
		const { url, goal, personas, model, simulate, output, json, steps, defender_mode } = ctx.values;
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

				const maxSteps = typeof steps === "number" && steps > 0 ? steps : 3;
				let hits: SearchHit[] = [];
				let visitedUrls: string[] = [];

				if (simulate || !browserWrap) {
					visitedUrls = [String(url)];
					hits = [1, 2, 3].map((i) => ({
						query: String(goal),
						title: `[mock] trend sample ${i}`,
						url: `${url}/mock/trend-${i}`,
						snippet: "mock snippet",
					}));
				} else {
					({ hits, visitedUrls } = await browseWithPersona(
						browserWrap.browser,
						llmClient,
						String(url),
						String(goal),
						persona,
						maxSteps,
					));
				}

				let summary = summarizeFromHitsFallback(persona, String(goal), hits);
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
						`Starting URL: ${url}`,
						`Goal: ${goal}`,
						`Pages visited (${visitedUrls.length}): ${visitedUrls.join(" → ")}`,
						"",
						"Evidence (content from all visited pages):",
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
					`visited: ${visitedUrls.join(" → ")}`,
					`hits: ${hits.length}`,
					`summary_head: ${safeSummary.slice(0, 220).replace(/\s+/g, " ")}`,
					"",
				].join("\n");
				await fs.appendFile(memoryPath, memoryEntry, "utf-8");

				const report: PersonaReport = {
					personaId,
					personaName: persona.name,
					goal: String(goal),
					visitedUrls,
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
