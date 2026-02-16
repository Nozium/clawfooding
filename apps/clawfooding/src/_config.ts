/**
 * Configuration resolution for ClawFooding CLI.
 *
 * Priority (highest to lowest):
 * 1. CLI flags (--scenario, --persona, --model, etc.)
 * 2. Scenario YAML file
 * 3. Environment variables (.env)
 * 4. Defaults
 */

export interface ResolvedConfig {
	targetUrl: string | undefined;
	model: string;
	billingDir: string;
	testEmail: string | undefined;
	testPassword: string | undefined;
	cfAccessClientId: string | undefined;
	cfAccessClientSecret: string | undefined;
	apiUrl: string | undefined;
	apiKey: string | undefined;
	anthropicApiKey: string | undefined;
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
	};
}
