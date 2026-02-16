import type {
	BillingReport,
	ModelName,
	ModelUsage,
	PersonaBillingRecord,
	PersonaBillingSummary,
	PersonaId,
	TokenUsage,
} from "./_types.ts";

// ── Pricing Data ───────────────────────────────────────────────────────────

interface ModelPricing {
	inputPerMToken: number;
	outputPerMToken: number;
	cacheCreationPerMToken: number;
	cacheReadPerMToken: number;
}

/**
 * Known model pricing (USD per million tokens).
 * Updated from LiteLLM / provider pricing pages.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
	"anthropic/claude-opus-4-5": {
		inputPerMToken: 15.0,
		outputPerMToken: 75.0,
		cacheCreationPerMToken: 18.75,
		cacheReadPerMToken: 1.5,
	},
	"anthropic/claude-sonnet-4-5": {
		inputPerMToken: 3.0,
		outputPerMToken: 15.0,
		cacheCreationPerMToken: 3.75,
		cacheReadPerMToken: 0.3,
	},
	"anthropic/claude-haiku-4-5": {
		inputPerMToken: 0.8,
		outputPerMToken: 4.0,
		cacheCreationPerMToken: 1.0,
		cacheReadPerMToken: 0.08,
	},
	"openai/gpt-4o": {
		inputPerMToken: 2.5,
		outputPerMToken: 10.0,
		cacheCreationPerMToken: 0,
		cacheReadPerMToken: 1.25,
	},
	"openai/gpt-4o-mini": {
		inputPerMToken: 0.15,
		outputPerMToken: 0.6,
		cacheCreationPerMToken: 0,
		cacheReadPerMToken: 0.075,
	},
	"google/gemini-2.5-flash": {
		inputPerMToken: 0.15,
		outputPerMToken: 0.6,
		cacheCreationPerMToken: 0,
		cacheReadPerMToken: 0.0375,
	},
	"deepseek/deepseek-chat": {
		inputPerMToken: 0.27,
		outputPerMToken: 1.1,
		cacheCreationPerMToken: 0,
		cacheReadPerMToken: 0.07,
	},
};

/**
 * Calculate cost for a single API call.
 */
export function calculateCost(
	model: string,
	tokens: TokenUsage,
): number {
	const pricing = MODEL_PRICING[model];
	if (!pricing) {
		// Unknown model: return 0, caller should handle
		return 0;
	}

	const inputCost = (tokens.inputTokens / 1_000_000) * pricing.inputPerMToken;
	const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputPerMToken;
	const cacheCreationCost =
		(tokens.cacheCreationInputTokens / 1_000_000) * pricing.cacheCreationPerMToken;
	const cacheReadCost =
		(tokens.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPerMToken;

	return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * Get pricing info for a model, or null if unknown.
 */
export function getModelPricing(model: string): ModelPricing | null {
	return MODEL_PRICING[model] ?? null;
}

/**
 * List all known model IDs.
 */
export function listKnownModels(): string[] {
	return Object.keys(MODEL_PRICING);
}

// ── Billing Tracker ────────────────────────────────────────────────────────

/**
 * In-memory billing tracker that records per-persona API usage
 * and generates billing reports.
 */
export class BillingTracker {
	private records: PersonaBillingRecord[] = [];

	/**
	 * Record a single API call's billing data.
	 */
	record(entry: PersonaBillingRecord): void {
		this.records.push(entry);
	}

	/**
	 * Get all records for a specific persona.
	 */
	getPersonaRecords(personaId: PersonaId): PersonaBillingRecord[] {
		return this.records.filter((r) => r.personaId === personaId);
	}

	/**
	 * Generate a per-persona billing summary.
	 */
	summarizePersona(
		personaId: PersonaId,
		personaName: string,
		scenarioName: string,
	): PersonaBillingSummary {
		const records = this.getPersonaRecords(personaId);

		const totalTokens: TokenUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
		};

		const modelMap = new Map<string, ModelUsage>();
		let totalCostUSD = 0;
		let recoveryCost = 0;
		let minTimestamp = Infinity;
		let maxTimestamp = -Infinity;

		for (const record of records) {
			totalTokens.inputTokens += record.tokens.inputTokens;
			totalTokens.outputTokens += record.tokens.outputTokens;
			totalTokens.cacheCreationInputTokens += record.tokens.cacheCreationInputTokens;
			totalTokens.cacheReadInputTokens += record.tokens.cacheReadInputTokens;
			totalCostUSD += record.costUSD;

			if (record.recoveryLevel > 0) {
				recoveryCost += record.costUSD;
			}

			const ts = new Date(record.timestamp).getTime();
			if (ts < minTimestamp) minTimestamp = ts;
			if (ts > maxTimestamp) maxTimestamp = ts;

			const existing = modelMap.get(record.model);
			if (existing) {
				existing.tokens.inputTokens += record.tokens.inputTokens;
				existing.tokens.outputTokens += record.tokens.outputTokens;
				existing.tokens.cacheCreationInputTokens += record.tokens.cacheCreationInputTokens;
				existing.tokens.cacheReadInputTokens += record.tokens.cacheReadInputTokens;
				existing.costUSD += record.costUSD;
				existing.requestCount += 1;
			} else {
				modelMap.set(record.model, {
					model: record.model,
					tokens: { ...record.tokens },
					costUSD: record.costUSD,
					requestCount: 1,
				});
			}
		}

		const duration =
			minTimestamp === Infinity ? 0 : maxTimestamp - minTimestamp;

		return {
			personaId,
			personaName,
			totalCostUSD,
			totalRequests: records.length,
			totalTokens,
			modelBreakdown: Array.from(modelMap.values()),
			averageCostPerStep: records.length > 0 ? totalCostUSD / records.length : 0,
			recoveryCost,
			scenarioName,
			duration,
		};
	}

	/**
	 * Generate a full billing report across all personas.
	 */
	generateReport(
		scenarioName: string,
		personaNames: Map<PersonaId, string>,
	): BillingReport {
		const personaIds = new Set(this.records.map((r) => r.personaId));
		const personas: PersonaBillingSummary[] = [];
		let totalCostUSD = 0;
		const globalModelMap = new Map<string, ModelUsage>();

		for (const pid of personaIds) {
			const name = personaNames.get(pid) ?? String(pid);
			const summary = this.summarizePersona(pid, name, scenarioName);
			personas.push(summary);
			totalCostUSD += summary.totalCostUSD;

			for (const mu of summary.modelBreakdown) {
				const existing = globalModelMap.get(mu.model);
				if (existing) {
					existing.tokens.inputTokens += mu.tokens.inputTokens;
					existing.tokens.outputTokens += mu.tokens.outputTokens;
					existing.tokens.cacheCreationInputTokens += mu.tokens.cacheCreationInputTokens;
					existing.tokens.cacheReadInputTokens += mu.tokens.cacheReadInputTokens;
					existing.costUSD += mu.costUSD;
					existing.requestCount += mu.requestCount;
				} else {
					globalModelMap.set(mu.model, {
						model: mu.model,
						tokens: { ...mu.tokens },
						costUSD: mu.costUSD,
						requestCount: mu.requestCount,
					});
				}
			}
		}

		const costPerPersonaComparison = personas
			.map((p) => ({
				personaId: p.personaId,
				personaName: p.personaName,
				costUSD: p.totalCostUSD,
				percentage: totalCostUSD > 0 ? (p.totalCostUSD / totalCostUSD) * 100 : 0,
			}))
			.sort((a, b) => b.costUSD - a.costUSD);

		return {
			generatedAt: new Date().toISOString(),
			scenarioName,
			personas,
			totalCostUSD,
			modelTotals: Array.from(globalModelMap.values()),
			costPerPersonaComparison,
		};
	}

	/**
	 * Export all records as JSONL for persistence.
	 */
	exportJsonl(): string {
		return this.records.map((r) => JSON.stringify(r)).join("\n");
	}

	/**
	 * Import records from JSONL.
	 */
	importJsonl(jsonl: string): void {
		const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
		for (const line of lines) {
			this.records.push(JSON.parse(line) as PersonaBillingRecord);
		}
	}

	/**
	 * Get the total number of records.
	 */
	get recordCount(): number {
		return this.records.length;
	}

	/**
	 * Clear all records.
	 */
	clear(): void {
		this.records = [];
	}
}
