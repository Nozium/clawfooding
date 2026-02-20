/**
 * Configuration resolution for ClawFooding CLI.
 *
 * Priority (highest to lowest):
 * 1. CLI flags (--scenario, --persona, --model, etc.)
 * 2. Scenario YAML file
 * 3. Environment variables (.env)
 * 4. Defaults
 */

import type { LLMClientConfig } from "@clawfooding/core/llm";

export interface ResolvedConfig {
	targetUrl: string | undefined;
	model: string;
	provider: "anthropic" | "openai" | "auto";
	billingDir: string;
	testEmail: string | undefined;
	testPassword: string | undefined;
	cfAccessClientId: string | undefined;
	cfAccessClientSecret: string | undefined;
	apiUrl: string | undefined;
	apiKey: string | undefined;
	anthropicApiKey: string | undefined;
	openaiApiKey: string | undefined;
	openaiOauthToken: string | undefined;
	openaiBaseUrl: string | undefined;
}

/**
 * Auto-detect the best default model based on available API keys.
 * Priority: OpenAI/Codex OAuth → OpenAI API Key → Anthropic API Key
 */
function autoDetectModel(): string {
	// Prefer OpenAI OAuth (Codex) if available
	if (process.env["OPENAI_OAUTH_TOKEN"] || process.env["CODEX_OAUTH_TOKEN"]) {
		return "openai/gpt-5.3-codex"; // Latest Codex agentic coding model
	}
	// OpenAI API key
	if (process.env["OPENAI_API_KEY"] || process.env["CODEX_API_KEY"]) {
		return "openai/gpt-4o";
	}
	// Anthropic API key
	if (process.env["ANTHROPIC_API_KEY"]) {
		return "anthropic/claude-sonnet-4-5";
	}
	// Fallback to Anthropic (will error later if key not set)
	return "anthropic/claude-sonnet-4-5";
}

export function resolveConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
	const openaiApiKey =
		overrides?.openaiApiKey ??
		process.env["OPENAI_API_KEY"] ??
		process.env["CODEX_API_KEY"];
	const openaiOauthToken =
		overrides?.openaiOauthToken ??
		process.env["OPENAI_OAUTH_TOKEN"] ??
		process.env["CODEX_OAUTH_TOKEN"];
	const anthropicApiKey =
		overrides?.anthropicApiKey ??
		process.env["ANTHROPIC_API_KEY"];

	return {
		targetUrl:
			overrides?.targetUrl ??
			process.env["CLAWFOODING_TARGET_URL"],
		model:
			overrides?.model ??
			process.env["CLAWFOODING_DEFAULT_MODEL"] ??
			autoDetectModel(),
		provider:
			overrides?.provider ??
			(process.env["CLAWFOODING_PROVIDER"] as "anthropic" | "openai" | "auto" | undefined) ??
			"auto",
		billingDir:
			overrides?.billingDir ??
			process.env["CLAWFOODING_BILLING_DIR"] ??
			".clawfooding/billing",
		testEmail:
			overrides?.testEmail ??
			process.env["CLAWFOODING_TEST_EMAIL"],
		testPassword:
			overrides?.testPassword ??
			process.env["CLAWFOODING_TEST_PASSWORD"],
		cfAccessClientId:
			overrides?.cfAccessClientId ??
			process.env["CF_ACCESS_CLIENT_ID"],
		cfAccessClientSecret:
			overrides?.cfAccessClientSecret ??
			process.env["CF_ACCESS_CLIENT_SECRET"],
		apiUrl:
			overrides?.apiUrl ??
			process.env["CLAWFOODING_API_URL"],
		apiKey:
			overrides?.apiKey ??
			process.env["CLAWFOODING_API_KEY"],
		anthropicApiKey,
		openaiApiKey,
		openaiOauthToken,
		openaiBaseUrl:
			overrides?.openaiBaseUrl ??
			process.env["OPENAI_BASE_URL"],
	};
}

export function toLLMClientConfig(config: ResolvedConfig): LLMClientConfig {
	return {
		provider: config.provider,
		model: config.model,
		anthropicApiKey: config.anthropicApiKey,
		openaiApiKey: config.openaiApiKey,
		openaiOauthToken: config.openaiOauthToken,
		openaiBaseUrl: config.openaiBaseUrl,
	};
}
