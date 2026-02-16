import * as fs from "node:fs/promises";
import * as path from "node:path";
import { define } from "gunshi";
import pc from "picocolors";
import { BillingTracker } from "@clawfooding/core/billing";
import type { PersonaId, PersonaBillingRecord, BillingReport } from "@clawfooding/core/types";
import { formatCurrency, formatTokens, formatPercentage } from "@clawfooding/terminal/format";
import { Table } from "@clawfooding/terminal/table";
import { sharedArgs } from "../_shared-args.ts";
import { DEFAULT_BILLING_DIR, BILLING_LOG_EXTENSION } from "../_consts.ts";

export const billingCommandDef = define({
	args: {
		...sharedArgs,
		dir: {
			type: "string",
			description: "Directory containing billing JSONL logs",
			default: DEFAULT_BILLING_DIR,
		},
		persona: {
			type: "string",
			short: "p",
			description: "Filter by persona ID",
		},
		group_by: {
			type: "string",
			short: "g",
			description: "Group results by: persona, model, session, daily",
			default: "persona",
		},
		since: {
			type: "string",
			short: "s",
			description: "Filter records since date (YYYY-MM-DD)",
		},
		until: {
			type: "string",
			short: "u",
			description: "Filter records until date (YYYY-MM-DD)",
		},
	},
	run: async (ctx) => {
		const { dir, persona, group_by, since, until, json } = ctx.values;
		const billingDir = dir ?? DEFAULT_BILLING_DIR;

		// ── Load billing records ─────────────────────────────────────────
		const tracker = new BillingTracker();
		let files: string[];

		try {
			const entries = await fs.readdir(billingDir);
			files = entries.filter((f) => f.endsWith(BILLING_LOG_EXTENSION));
		} catch {
			console.error(pc.red(`No billing data found in ${billingDir}`));
			console.log(pc.dim("Run 'clawfooding run --scenario <path>' to generate billing data."));
			process.exit(1);
		}

		if (files.length === 0) {
			console.error(pc.red(`No billing logs found in ${billingDir}`));
			process.exit(1);
		}

		for (const file of files) {
			const content = await fs.readFile(path.join(billingDir, file), "utf-8");
			tracker.importJsonl(content);
		}

		console.log(pc.dim(`Loaded ${tracker.recordCount} billing records from ${files.length} files\n`));

		// ── Generate report ──────────────────────────────────────────────
		const personaNames = new Map<PersonaId, string>();
		const report = tracker.generateReport("All Scenarios", personaNames);

		if (json) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}

		// ── Render based on group_by ─────────────────────────────────────
		switch (group_by) {
			case "persona":
				renderByPersona(report);
				break;
			case "model":
				renderByModel(report);
				break;
			case "daily":
				renderByDaily(tracker);
				break;
			case "session":
				renderBySession(tracker);
				break;
			default:
				renderByPersona(report);
		}
	},
});

function renderByPersona(report: BillingReport): void {
	console.log(pc.bold("── Billing by Persona ──\n"));

	const table = new Table({
		columns: [
			{ header: "Persona", width: 25, align: "left" },
			{ header: "Requests", width: 10, align: "right" },
			{ header: "Input", width: 12, align: "right" },
			{ header: "Output", width: 12, align: "right" },
			{ header: "Cache R", width: 10, align: "right" },
			{ header: "Total Cost", width: 12, align: "right" },
			{ header: "Avg/Step", width: 10, align: "right" },
			{ header: "Share", width: 8, align: "right" },
		],
	});

	for (const p of report.personas) {
		const comp = report.costPerPersonaComparison.find(
			(c) => c.personaId === p.personaId,
		);
		table.addRow([
			p.personaName || String(p.personaId),
			String(p.totalRequests),
			formatTokens(p.totalTokens.inputTokens),
			formatTokens(p.totalTokens.outputTokens),
			formatTokens(p.totalTokens.cacheReadInputTokens),
			formatCurrency(p.totalCostUSD),
			formatCurrency(p.averageCostPerStep),
			comp ? formatPercentage(comp.percentage) : "—",
		]);
	}

	table.addSeparator();
	table.addRow([
		pc.bold("TOTAL"),
		String(report.personas.reduce((s, p) => s + p.totalRequests, 0)),
		"",
		"",
		"",
		pc.bold(formatCurrency(report.totalCostUSD)),
		"",
		"100%",
	]);

	console.log(table.render());

	// Per-persona model breakdown
	for (const p of report.personas) {
		if (p.modelBreakdown.length <= 1) continue;

		console.log(pc.bold(`  ${p.personaName} - Model Breakdown:`));
		for (const m of p.modelBreakdown) {
			console.log(
				`    ${String(m.model).padEnd(35)} ${formatCurrency(m.costUSD).padStart(10)} (${m.requestCount} reqs)`,
			);
		}
		console.log("");
	}
}

function renderByModel(report: BillingReport): void {
	console.log(pc.bold("── Billing by Model ──\n"));

	const table = new Table({
		columns: [
			{ header: "Model", width: 35, align: "left" },
			{ header: "Requests", width: 10, align: "right" },
			{ header: "Input", width: 12, align: "right" },
			{ header: "Output", width: 12, align: "right" },
			{ header: "Total Cost", width: 12, align: "right" },
		],
	});

	for (const m of report.modelTotals) {
		table.addRow([
			String(m.model),
			String(m.requestCount),
			formatTokens(m.tokens.inputTokens),
			formatTokens(m.tokens.outputTokens),
			formatCurrency(m.costUSD),
		]);
	}

	table.addSeparator();
	table.addRow([
		pc.bold("TOTAL"),
		String(report.modelTotals.reduce((s, m) => s + m.requestCount, 0)),
		"",
		"",
		pc.bold(formatCurrency(report.totalCostUSD)),
	]);

	console.log(table.render());
}

function renderByDaily(tracker: BillingTracker): void {
	console.log(pc.bold("── Billing by Day ──\n"));

	const records = tracker.getAllRecords();
	const dailyMap = new Map<string, { requests: number; costUSD: number; inputTokens: number; outputTokens: number }>();

	for (const r of records) {
		const day = r.timestamp.slice(0, 10); // YYYY-MM-DD
		const existing = dailyMap.get(day);
		if (existing) {
			existing.requests += 1;
			existing.costUSD += r.costUSD;
			existing.inputTokens += r.tokens.inputTokens;
			existing.outputTokens += r.tokens.outputTokens;
		} else {
			dailyMap.set(day, {
				requests: 1,
				costUSD: r.costUSD,
				inputTokens: r.tokens.inputTokens,
				outputTokens: r.tokens.outputTokens,
			});
		}
	}

	const table = new Table({
		columns: [
			{ header: "Date", width: 14, align: "left" },
			{ header: "Requests", width: 10, align: "right" },
			{ header: "Input", width: 12, align: "right" },
			{ header: "Output", width: 12, align: "right" },
			{ header: "Cost", width: 12, align: "right" },
		],
	});

	const sortedDays = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b));
	let totalCost = 0;
	let totalRequests = 0;

	for (const [day, data] of sortedDays) {
		table.addRow([
			day,
			String(data.requests),
			formatTokens(data.inputTokens),
			formatTokens(data.outputTokens),
			formatCurrency(data.costUSD),
		]);
		totalCost += data.costUSD;
		totalRequests += data.requests;
	}

	table.addSeparator();
	table.addRow([
		pc.bold("TOTAL"),
		String(totalRequests),
		"",
		"",
		pc.bold(formatCurrency(totalCost)),
	]);

	console.log(table.render());
}

function renderBySession(tracker: BillingTracker): void {
	console.log(pc.bold("── Billing by Session ──\n"));

	const records = tracker.getAllRecords();
	const sessionMap = new Map<string, { persona: string; requests: number; costUSD: number; model: string }>();

	for (const r of records) {
		const key = String(r.sessionId);
		const existing = sessionMap.get(key);
		if (existing) {
			existing.requests += 1;
			existing.costUSD += r.costUSD;
		} else {
			sessionMap.set(key, {
				persona: String(r.personaId),
				requests: 1,
				costUSD: r.costUSD,
				model: String(r.model),
			});
		}
	}

	const table = new Table({
		columns: [
			{ header: "Session", width: 30, align: "left" },
			{ header: "Persona", width: 15, align: "left" },
			{ header: "Model", width: 25, align: "left" },
			{ header: "Reqs", width: 6, align: "right" },
			{ header: "Cost", width: 12, align: "right" },
		],
	});

	const sorted = Array.from(sessionMap.entries()).sort(([, a], [, b]) => b.costUSD - a.costUSD);

	for (const [sessionId, data] of sorted) {
		table.addRow([
			sessionId.length > 28 ? `${sessionId.slice(0, 28)}..` : sessionId,
			data.persona,
			data.model,
			String(data.requests),
			formatCurrency(data.costUSD),
		]);
	}

	console.log(table.render());
}
