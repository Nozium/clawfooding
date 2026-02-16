import * as v from "valibot";

// ── Branded Types ──────────────────────────────────────────────────────────

export const personaIdSchema = v.pipe(
	v.string(),
	v.minLength(1, "Persona ID cannot be empty"),
	v.brand("PersonaId"),
);
export type PersonaId = v.InferOutput<typeof personaIdSchema>;
export const createPersonaId = (value: string): PersonaId =>
	v.parse(personaIdSchema, value);

export const sessionIdSchema = v.pipe(
	v.string(),
	v.minLength(1, "Session ID cannot be empty"),
	v.brand("SessionId"),
);
export type SessionId = v.InferOutput<typeof sessionIdSchema>;
export const createSessionId = (value: string): SessionId =>
	v.parse(sessionIdSchema, value);

export const modelNameSchema = v.pipe(
	v.string(),
	v.minLength(1, "Model name cannot be empty"),
	v.brand("ModelName"),
);
export type ModelName = v.InferOutput<typeof modelNameSchema>;
export const createModelName = (value: string): ModelName =>
	v.parse(modelNameSchema, value);

// ── Enums ──────────────────────────────────────────────────────────────────

export const TechLevels = ["novice", "intermediate", "advanced", "expert"] as const;
export type TechLevel = (typeof TechLevels)[number];

export const NavigationStrategies = ["exploratory", "goal-directed", "habitual"] as const;
export type NavigationStrategy = (typeof NavigationStrategies)[number];

export const InformationProcessings = ["serial", "parallel"] as const;
export type InformationProcessing = (typeof InformationProcessings)[number];

export const RiskTolerances = ["low", "medium", "high"] as const;
export type RiskTolerance = (typeof RiskTolerances)[number];

export const ErrorRecoveries = ["retreat", "retry", "explore_alternative"] as const;
export type ErrorRecovery = (typeof ErrorRecoveries)[number];

export const ReadingPatterns = ["f_pattern", "z_pattern", "scanning", "linear"] as const;
export type ReadingPattern = (typeof ReadingPatterns)[number];

export const AttentionSpans = ["short", "medium", "long"] as const;
export type AttentionSpan = (typeof AttentionSpans)[number];

export const DecisionSpeeds = ["slow", "medium", "fast"] as const;
export type DecisionSpeed = (typeof DecisionSpeeds)[number];

export const PointerPrecisions = ["low", "medium", "high"] as const;
export type PointerPrecision = (typeof PointerPrecisions)[number];

export const ScrollBehaviors = ["gradual", "aggressive", "minimal"] as const;
export type ScrollBehavior = (typeof ScrollBehaviors)[number];

export const Motivations = ["task_completion", "exploration", "comparison"] as const;
export type Motivation = (typeof Motivations)[number];

export const TimePressures = ["none", "low", "medium", "high"] as const;
export type TimePressure = (typeof TimePressures)[number];

export const Familiarities = ["first_visit", "returning", "daily_user"] as const;
export type Familiarity = (typeof Familiarities)[number];

export const EmotionalStates = ["calm", "neutral", "frustrated", "anxious"] as const;
export type EmotionalState = (typeof EmotionalStates)[number];

export const Environments = ["desktop_office", "mobile_commute", "tablet_couch"] as const;
export type Environment = (typeof Environments)[number];

// ── Persona Schema ─────────────────────────────────────────────────────────

export const demographicsSchema = v.object({
	age: v.pipe(v.number(), v.minValue(1), v.maxValue(120)),
	tech_level: v.picklist(TechLevels),
	device: v.string(),
	language: v.string(),
	accessibility: v.optional(v.string(), "none"),
});
export type Demographics = v.InferOutput<typeof demographicsSchema>;

export const cognitiveProfileSchema = v.object({
	navigation_strategy: v.picklist(NavigationStrategies),
	information_processing: v.picklist(InformationProcessings),
	risk_tolerance: v.picklist(RiskTolerances),
	error_recovery: v.picklist(ErrorRecoveries),
	reading_pattern: v.picklist(ReadingPatterns),
	working_memory_load: v.pipe(v.number(), v.minValue(2), v.maxValue(9)),
	attention_span: v.picklist(AttentionSpans),
	decision_speed: v.picklist(DecisionSpeeds),
});
export type CognitiveProfile = v.InferOutput<typeof cognitiveProfileSchema>;

export const motorProfileSchema = v.object({
	pointer_precision: v.picklist(PointerPrecisions),
	click_speed_ms: v.pipe(v.number(), v.minValue(50), v.maxValue(2000)),
	scroll_behavior: v.picklist(ScrollBehaviors),
	tap_accuracy_offset_px: v.pipe(v.number(), v.minValue(0), v.maxValue(50)),
});
export type MotorProfile = v.InferOutput<typeof motorProfileSchema>;

export const contextSchema = v.object({
	motivation: v.picklist(Motivations),
	time_pressure: v.picklist(TimePressures),
	familiarity: v.picklist(Familiarities),
	emotional_state: v.picklist(EmotionalStates),
	environment: v.picklist(Environments),
});
export type Context = v.InferOutput<typeof contextSchema>;

export const personaSchema = v.object({
	name: v.string(),
	description: v.optional(v.string()),
	demographics: demographicsSchema,
	cognitive_profile: cognitiveProfileSchema,
	motor_profile: motorProfileSchema,
	context: contextSchema,
});
export type Persona = v.InferOutput<typeof personaSchema>;

// ── Security Types ─────────────────────────────────────────────────────────

export const permissionsSchema = v.object({
	navigation: v.picklist(["allow", "deny"]),
	click: v.picklist(["allow", "deny"]),
	type: v.picklist(["allow", "deny"]),
	submit: v.picklist(["allow", "deny"]),
	delete: v.picklist(["allow", "deny"]),
	download: v.picklist(["allow", "deny"]),
	external_navigation: v.picklist(["allow", "deny"]),
	max_requests_per_minute: v.pipe(v.number(), v.minValue(1)),
	max_session_duration: v.pipe(v.number(), v.minValue(1)),
	url_allowlist: v.array(v.string()),
	url_denylist: v.optional(v.array(v.string()), []),
});
export type Permissions = v.InferOutput<typeof permissionsSchema>;

export const recoveryConfigSchema = v.object({
	enabled: v.optional(v.boolean(), true),
	max_level: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(5)), 5),
	max_retries_per_step: v.optional(v.pipe(v.number(), v.minValue(1)), 3),
	ai_summary: v.optional(
		v.object({
			model: v.optional(v.string(), "anthropic/claude-haiku-4-5"),
			prompt_template: v.optional(v.string(), "default"),
		}),
	),
	external_search: v.optional(
		v.object({
			enabled: v.optional(v.boolean(), true),
			allowed_domains: v.optional(v.array(v.string()), []),
		}),
	),
	documentation: v.optional(
		v.object({
			urls: v.optional(v.array(v.string()), []),
		}),
	),
});
export type RecoveryConfig = v.InferOutput<typeof recoveryConfigSchema>;

export const authConfigSchema = v.object({
	method: v.picklist([
		"test_account",
		"oauth_service_account",
		"cookie_injection",
		"bypass_token",
		"magic_link",
	]),
	credentials: v.optional(v.record(v.string(), v.string())),
});
export type AuthConfig = v.InferOutput<typeof authConfigSchema>;

export const multiModelConfigSchema = v.object({
	enabled: v.optional(v.boolean(), false),
	mode: v.optional(v.picklist(["benchmark", "cost_optimize", "fallback_chain"]), "benchmark"),
	models: v.array(v.string()),
	parallel: v.optional(v.boolean(), false),
	output: v.optional(
		v.object({
			comparison_matrix: v.optional(v.boolean(), true),
			cost_analysis: v.optional(v.boolean(), true),
			model_recommendation: v.optional(v.boolean(), true),
		}),
	),
});
export type MultiModelConfig = v.InferOutput<typeof multiModelConfigSchema>;

// ── Scenario Schema ────────────────────────────────────────────────────────

export const scenarioSchema = v.object({
	name: v.string(),
	description: v.optional(v.string()),
	target_url: v.pipe(v.string(), v.url()),
	auth: v.optional(authConfigSchema),
	personas: v.array(v.string()),
	permissions: permissionsSchema,
	recovery: v.optional(recoveryConfigSchema),
	multi_model: v.optional(multiModelConfigSchema),
	steps: v.optional(
		v.array(
			v.object({
				action: v.string(),
				description: v.optional(v.string()),
				expected: v.optional(v.string()),
			}),
		),
	),
	cleanup: v.optional(
		v.array(
			v.object({
				action: v.string(),
				params: v.optional(v.record(v.string(), v.unknown())),
			}),
		),
	),
});
export type Scenario = v.InferOutput<typeof scenarioSchema>;

// ── Billing Types ──────────────────────────────────────────────────────────

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens: number;
	cacheReadInputTokens: number;
}

export interface ModelUsage {
	model: ModelName;
	tokens: TokenUsage;
	costUSD: number;
	requestCount: number;
}

export interface PersonaBillingRecord {
	personaId: PersonaId;
	sessionId: SessionId;
	timestamp: string;
	model: ModelName;
	tokens: TokenUsage;
	costUSD: number;
	step: string;
	recoveryLevel: number;
}

export interface PersonaBillingSummary {
	personaId: PersonaId;
	personaName: string;
	totalCostUSD: number;
	totalRequests: number;
	totalTokens: TokenUsage;
	modelBreakdown: ModelUsage[];
	averageCostPerStep: number;
	recoveryCost: number;
	scenarioName: string;
	duration: number;
}

export interface BillingReport {
	generatedAt: string;
	scenarioName: string;
	personas: PersonaBillingSummary[];
	totalCostUSD: number;
	modelTotals: ModelUsage[];
	costPerPersonaComparison: Array<{
		personaId: PersonaId;
		personaName: string;
		costUSD: number;
		percentage: number;
	}>;
}
