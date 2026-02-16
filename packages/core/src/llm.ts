import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { TokenUsage } from "./_types.ts";

// ── Types ─────────────────────────────────────────────────────────────────

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatOptions {
	maxTokens?: number;
	temperature?: number;
}

export interface ChatResult {
	content: string;
	tokens: TokenUsage;
	model: string;
	latencyMs: number;
}

export interface LLMClientConfig {
	provider?: "anthropic" | "openai" | "auto";
	model: string;
	anthropicApiKey?: string;
	openaiApiKey?: string;
	openaiBaseUrl?: string;
}

export interface LLMClient {
	chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResult>;
}

// ── Provider Detection ────────────────────────────────────────────────────

function detectProvider(config: LLMClientConfig): "anthropic" | "openai" {
	if (config.provider && config.provider !== "auto") {
		return config.provider;
	}

	const model = config.model.toLowerCase();
	if (
		model.startsWith("anthropic/") ||
		model.startsWith("claude-") ||
		model.includes("claude")
	) {
		return "anthropic";
	}

	return "openai";
}

function stripModelPrefix(model: string): string {
	if (model.startsWith("anthropic/")) return model.slice("anthropic/".length);
	if (model.startsWith("openai/")) return model.slice("openai/".length);
	if (model.startsWith("google/")) return model.slice("google/".length);
	if (model.startsWith("deepseek/")) return model.slice("deepseek/".length);
	return model;
}

// ── Anthropic Client ──────────────────────────────────────────────────────

class AnthropicLLMClient implements LLMClient {
	private client: Anthropic;
	private model: string;

	constructor(config: LLMClientConfig) {
		const apiKey =
			config.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"];
		if (!apiKey) {
			throw new Error(
				"ANTHROPIC_API_KEY is required. Set it via environment variable or --api-key flag.",
			);
		}
		this.client = new Anthropic({ apiKey });
		this.model = stripModelPrefix(config.model);
	}

	async chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResult> {
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages
			.filter((m) => m.role !== "system")
			.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			}));

		const start = performance.now();

		const response = await this.client.messages.create({
			model: this.model,
			max_tokens: options?.maxTokens ?? 4096,
			temperature: options?.temperature ?? 0.7,
			system: systemMsg?.content,
			messages: nonSystemMsgs,
		});

		const latencyMs = performance.now() - start;

		const content = response.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("");

		return {
			content,
			tokens: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
				cacheCreationInputTokens:
					(response.usage as Record<string, number>)["cache_creation_input_tokens"] ?? 0,
				cacheReadInputTokens:
					(response.usage as Record<string, number>)["cache_read_input_tokens"] ?? 0,
			},
			model: response.model,
			latencyMs: Math.round(latencyMs),
		};
	}
}

// ── OpenAI-Compatible Client ──────────────────────────────────────────────

class OpenAILLMClient implements LLMClient {
	private client: OpenAI;
	private model: string;

	constructor(config: LLMClientConfig) {
		const apiKey =
			config.openaiApiKey ??
			process.env["OPENAI_API_KEY"] ??
			process.env["CODEX_API_KEY"];
		if (!apiKey) {
			throw new Error(
				"OPENAI_API_KEY is required. Set it via environment variable or --api-key flag.\n" +
				"For Codex CLI: use CODEX_API_KEY or OPENAI_API_KEY.\n" +
				"For local models: set OPENAI_BASE_URL (e.g., http://localhost:11434/v1).",
			);
		}
		this.client = new OpenAI({
			apiKey,
			baseURL:
				config.openaiBaseUrl ?? process.env["OPENAI_BASE_URL"],
		});
		this.model = stripModelPrefix(config.model);
	}

	async chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResult> {
		const start = performance.now();

		const response = await this.client.chat.completions.create({
			model: this.model,
			max_tokens: options?.maxTokens ?? 4096,
			temperature: options?.temperature ?? 0.7,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		});

		const latencyMs = performance.now() - start;

		const choice = response.choices[0];
		const content = choice?.message?.content ?? "";

		return {
			content,
			tokens: {
				inputTokens: response.usage?.prompt_tokens ?? 0,
				outputTokens: response.usage?.completion_tokens ?? 0,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
			},
			model: response.model,
			latencyMs: Math.round(latencyMs),
		};
	}
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createLLMClient(config: LLMClientConfig): LLMClient {
	const provider = detectProvider(config);

	switch (provider) {
		case "anthropic":
			return new AnthropicLLMClient(config);
		case "openai":
			return new OpenAILLMClient(config);
	}
}

/**
 * Validate that required API keys are available for the given model.
 * Returns null if valid, or an error message string.
 */
export function validateApiConfig(config: LLMClientConfig): string | null {
	const provider = detectProvider(config);

	if (provider === "anthropic") {
		const key = config.anthropicApiKey ?? process.env["ANTHROPIC_API_KEY"];
		if (!key) {
			return "ANTHROPIC_API_KEY is not set. Set it via environment variable or use --simulate for offline mode.";
		}
	}

	if (provider === "openai") {
		const key =
			config.openaiApiKey ??
			process.env["OPENAI_API_KEY"] ??
			process.env["CODEX_API_KEY"];
		if (!key) {
			return "OPENAI_API_KEY (or CODEX_API_KEY) is not set. Set it via environment variable or use --simulate for offline mode.";
		}
	}

	return null;
}

// ── In-source Tests ───────────────────────────────────────────────────────

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	describe("detectProvider", () => {
		it("detects anthropic from model name", () => {
			expect(detectProvider({ model: "anthropic/claude-sonnet-4-5" })).toBe("anthropic");
			expect(detectProvider({ model: "claude-haiku-4-5" })).toBe("anthropic");
		});

		it("detects openai from model name", () => {
			expect(detectProvider({ model: "gpt-4o" })).toBe("openai");
			expect(detectProvider({ model: "openai/gpt-4o-mini" })).toBe("openai");
		});

		it("respects explicit provider", () => {
			expect(detectProvider({ model: "my-model", provider: "anthropic" })).toBe("anthropic");
			expect(detectProvider({ model: "claude-3", provider: "openai" })).toBe("openai");
		});
	});

	describe("stripModelPrefix", () => {
		it("strips known prefixes", () => {
			expect(stripModelPrefix("anthropic/claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
			expect(stripModelPrefix("openai/gpt-4o")).toBe("gpt-4o");
			expect(stripModelPrefix("gpt-4o")).toBe("gpt-4o");
		});
	});

	describe("validateApiConfig", () => {
		it("returns error when anthropic key missing", () => {
			const original = process.env["ANTHROPIC_API_KEY"];
			delete process.env["ANTHROPIC_API_KEY"];
			const result = validateApiConfig({ model: "anthropic/claude-sonnet-4-5" });
			expect(result).toContain("ANTHROPIC_API_KEY");
			if (original) process.env["ANTHROPIC_API_KEY"] = original;
		});

		it("returns null when key is provided in config", () => {
			const result = validateApiConfig({
				model: "anthropic/claude-sonnet-4-5",
				anthropicApiKey: "sk-ant-test",
			});
			expect(result).toBeNull();
		});
	});
}
