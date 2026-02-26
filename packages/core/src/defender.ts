/// <reference path="./openclaw-defender.d.ts" />

export type DefenderMode = "off" | "warn" | "block";

export interface DefenderResult {
	mode: DefenderMode;
	source: "openclaw-defender" | "builtin" | "off";
	redactedText: string;
	blocked: boolean;
	findings: string[];
}

function redactSecrets(text: string): string {
	let out = text;
	// Common API key formats
	out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]");
	out = out.replace(/\brt_[A-Za-z0-9._-]{12,}\b/g, "[REDACTED_REFRESH_TOKEN]");
	// JWT-like tokens
	out = out.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, "[REDACTED_JWT]");
	return out;
}

function detectFindings(text: string): string[] {
	const findings: string[] = [];
	const lower = text.toLowerCase();

	if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(text) || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/.test(text)) {
		findings.push("secret_token_detected");
	}

	if (
		/(api key|access token|refresh token|password|secret|credential)/i.test(text) &&
		/(send|share|paste|give|provide|教えて|共有|貼って|入力)/i.test(text)
	) {
		findings.push("credential_request_detected");
	}

	if (lower.includes("ignore previous instructions") || lower.includes("reveal your system prompt")) {
		findings.push("prompt_injection_pattern");
	}

	return findings;
}

function decideBlocked(mode: DefenderMode, findings: string[]): boolean {
	if (mode !== "block") return false;
	return findings.length > 0;
}

function parseExternalDefenderResult(
	mode: DefenderMode,
	text: string,
	raw: unknown,
): DefenderResult | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const blocked = typeof obj.blocked === "boolean" ? obj.blocked : false;
	const findings = Array.isArray(obj.findings)
		? obj.findings.filter((x): x is string => typeof x === "string")
		: [];
	const redactedText =
		typeof obj.redactedText === "string" ? obj.redactedText :
		typeof obj.sanitized === "string" ? obj.sanitized :
		redactSecrets(text);

	return {
		mode,
		source: "openclaw-defender",
		redactedText,
		blocked: blocked || decideBlocked(mode, findings),
		findings,
	};
}

export async function defendText(text: string, mode: DefenderMode): Promise<DefenderResult> {
	if (mode === "off") {
		return {
			mode,
			source: "off",
			redactedText: text,
			blocked: false,
			findings: [],
		};
	}

	// Optional external integration via openclaw-defender.
	// Uses Layer 1 (sync regex/keyword rules, <1ms) for injection detection.
	// Secret redaction always runs via builtin regardless.
	try {
		const mod = (await import("openclaw-defender")) as Record<string, unknown>;
		const createScanner = mod["createScanner"] as
			| ((config: Record<string, unknown>) => {
					scanSync: (text: string) => {
						blocked: boolean;
						findings: Array<{
							ruleId: string;
							category: string;
							severity: string;
							message: string;
						}>;
					};
			  })
			| undefined;

		if (typeof createScanner === "function") {
			const scanner = createScanner({});
			const result = scanner.scanSync(text);

			// Builtin secret redaction always runs on top of openclaw-defender
			const redactedText = redactSecrets(text);
			const builtinFindings = detectFindings(text);
			const externalFindings = result.findings.map(
				(f) => `${f.category}:${f.ruleId} (${f.severity})`,
			);
			const allFindings = [...builtinFindings, ...externalFindings];

			return {
				mode,
				source: "openclaw-defender",
				redactedText,
				blocked: decideBlocked(mode, allFindings) || (mode === "block" && result.blocked),
				findings: allFindings,
			};
		}
	} catch {
		// Package not installed or load failed — fallback to builtin
	}

	const redactedText = redactSecrets(text);
	const findings = detectFindings(text);
	return {
		mode,
		source: "builtin",
		redactedText,
		blocked: decideBlocked(mode, findings),
		findings,
	};
}

