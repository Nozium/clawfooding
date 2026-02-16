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
	openaiBaseUrl: string | undefined;
}

export function resolveConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
	return {
		targetUrl:
			overrides?.targetUrl ??
			process.env["CLAWFOODING_TARGET_URL"],
		model:
			overrides?.model ??
			process.env["CLAWFOODING_DEFAULT_MODEL"] ??
			"anthropic/claude-sonnet-4-5",
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
		anthropicApiKey:
			overrides?.anthropicApiKey ??
			process.env["ANTHROPIC_API_KEY"],
		openaiApiKey:
			overrides?.openaiApiKey ??
			process.env["OPENAI_API_KEY"] ??
			process.env["CODEX_API_KEY"],
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
		openaiBaseUrl: config.openaiBaseUrl,
	};
}
