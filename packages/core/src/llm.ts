import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
	provider?: "anthropic" | "openai" | "codex" | "auto";
	model: string;
	anthropicApiKey?: string;
	openaiApiKey?: string;
	openaiOauthToken?: string;
	openaiBaseUrl?: string;
}

export interface LLMClient {
	chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResult>;
}

// ── Provider Detection ────────────────────────────────────────────────────

function detectProvider(config: LLMClientConfig): "anthropic" | "openai" | "codex" {
	if (config.provider && config.provider !== "auto") {
		return config.provider;
	}

	const model = config.model.toLowerCase();
	if (model.startsWith("openai-codex/")) {
		return "codex";
	}
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
	if (model.startsWith("openai-codex/")) return model.slice("openai-codex/".length);
	if (model.startsWith("google/")) return model.slice("google/".length);
	if (model.startsWith("deepseek/")) return model.slice("deepseek/".length);
	return model;
}

function resolveOpenAICredential(config: LLMClientConfig): string | null {
	return (
		config.openaiApiKey ??
		config.openaiOauthToken ??
		process.env["OPENAI_API_KEY"] ??
		process.env["CODEX_API_KEY"] ??
		process.env["OPENAI_OAUTH_TOKEN"] ??
		process.env["CODEX_OAUTH_TOKEN"] ??
		null
	);
}

// ── Codex OAuth ───────────────────────────────────────────────────────────

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function resolveCodexHome(): string {
	const configured = process.env["CODEX_HOME"];
	return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
}

function readCodexAccessToken(config: LLMClientConfig): string | null {
	// Explicit env vars take priority
	const fromEnv =
		config.openaiOauthToken ??
		process.env["OPENAI_OAUTH_TOKEN"] ??
		process.env["CODEX_OAUTH_TOKEN"];
	if (fromEnv) return fromEnv;

	// Fall back to ~/.codex/auth.json (same structure as openclaw cli-credentials.ts)
	try {
		const authPath = path.join(resolveCodexHome(), "auth.json");
		const raw = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<string, unknown>;
		const tokens = raw["tokens"] as Record<string, unknown> | undefined;
		const token = tokens?.["access_token"];
		if (typeof token === "string" && token) return token;
	} catch {
		// auth.json not found or malformed — fall through
	}
	return null;
}

// ── Codex Client (chatgpt.com/backend-api/codex/responses) ───────────────

class CodexLLMClient implements LLMClient {
	private client: OpenAI;
	private model: string;

	constructor(config: LLMClientConfig) {
		const token = readCodexAccessToken(config);
		if (!token) {
			throw new Error(
				"Codex OAuth token is not available.\n" +
				"Log in via Codex CLI (`codex login`) or set OPENAI_OAUTH_TOKEN / CODEX_OAUTH_TOKEN.",
			);
		}
		this.client = new OpenAI({
			apiKey: token,
			baseURL: CODEX_BASE_URL,
		});
		this.model = stripModelPrefix(config.model);
	}

	async chat(messages: LLMMessage[], options?: ChatOptions): Promise<ChatResult> {
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages.filter((m) => m.role !== "system");

		const input = nonSystemMsgs.map((m) => ({
			type: "message" as const,
			role: m.role as "user" | "assistant",
			content: [{ type: "input_text" as const, text: m.content }],
		}));

		const start = performance.now();

		// Uses OpenAI Responses API; store=false is required for Codex endpoint.
		const response = await (this.client.responses as unknown as {
			create: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
		}).create({
			model: this.model,
			instructions: systemMsg?.content,
			input,
			store: false,
			max_output_tokens: options?.maxTokens ?? 4096,
			temperature: options?.temperature ?? 0.7,
		});

		const latencyMs = performance.now() - start;

		// Extract text from response (output_text shorthand or output array)
		let content = "";
		if (typeof response["output_text"] === "string") {
			content = response["output_text"];
		} else {
			const output = response["output"] as Array<Record<string, unknown>> | undefined;
			content = output
				?.flatMap((item) => {
					const parts = item["content"] as Array<Record<string, unknown>> | undefined;
					return parts?.map((p) => (typeof p["text"] === "string" ? p["text"] : "")) ?? [];
				})
				.join("") ?? "";
		}

		const usage = response["usage"] as Record<string, number> | undefined;

		return {
			content,
			tokens: {
				inputTokens: usage?.["input_tokens"] ?? 0,
				outputTokens: usage?.["output_tokens"] ?? 0,
				cacheCreationInputTokens: 0,
				cacheReadInputTokens: 0,
			},
			model: (response["model"] as string | undefined) ?? this.model,
			latencyMs: Math.round(latencyMs),
		};
	}
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
					(response.usage as unknown as Record<string, number>)["cache_creation_input_tokens"] ?? 0,
				cacheReadInputTokens:
					(response.usage as unknown as Record<string, number>)["cache_read_input_tokens"] ?? 0,
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
		const apiKey = resolveOpenAICredential(config);
		if (!apiKey) {
			throw new Error(
				"OPENAI_API_KEY is required. Set it via environment variable or --api-key flag.\n" +
				"For Codex/ChatGPT OAuth: use OPENAI_OAUTH_TOKEN or CODEX_OAUTH_TOKEN.\n" +
				"For API keys: use OPENAI_API_KEY or CODEX_API_KEY.\n" +
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
		case "codex":
			return new CodexLLMClient(config);
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

	if (provider === "codex") {
		const token = readCodexAccessToken(config);
		if (!token) {
			return "Codex OAuth token is not available. Log in via Codex CLI or set OPENAI_OAUTH_TOKEN / CODEX_OAUTH_TOKEN.";
		}
	}

	if (provider === "openai") {
		const key = resolveOpenAICredential(config);
		if (!key) {
			return "OpenAI credential is not set. Use OPENAI_API_KEY/CODEX_API_KEY or OPENAI_OAUTH_TOKEN/CODEX_OAUTH_TOKEN, or use --simulate for offline mode.";
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
			expect(stripModelPrefix("openai-codex/gpt-5.3-codex")).toBe("gpt-5.3-codex");
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

		it("accepts OpenAI OAuth token from env", () => {
			const originalApi = process.env["OPENAI_API_KEY"];
			const originalCodex = process.env["CODEX_API_KEY"];
			const originalOauth = process.env["OPENAI_OAUTH_TOKEN"];
			delete process.env["OPENAI_API_KEY"];
			delete process.env["CODEX_API_KEY"];
			process.env["OPENAI_OAUTH_TOKEN"] = "oauth-test";

			const result = validateApiConfig({
				model: "openai-codex/gpt-5.3-codex",
			});
			expect(result).toBeNull();

			if (originalApi) process.env["OPENAI_API_KEY"] = originalApi;
			else delete process.env["OPENAI_API_KEY"];
			if (originalCodex) process.env["CODEX_API_KEY"] = originalCodex;
			else delete process.env["CODEX_API_KEY"];
			if (originalOauth) process.env["OPENAI_OAUTH_TOKEN"] = originalOauth;
			else delete process.env["OPENAI_OAUTH_TOKEN"];
		});
	});
}
