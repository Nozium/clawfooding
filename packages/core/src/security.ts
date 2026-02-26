import * as v from "valibot";
import type { Permissions } from "./_types.ts";

// ── URL Access Control ─────────────────────────────────────────────────────

/**
 * Check if a URL is allowed by the permissions configuration.
 */
export function isUrlAllowed(url: string, permissions: Permissions): boolean {
	// Check denylist first (deny takes precedence)
	if (permissions.url_denylist) {
		for (const pattern of permissions.url_denylist) {
			if (matchUrlPattern(url, pattern)) return false;
		}
	}

	// Check allowlist
	for (const pattern of permissions.url_allowlist) {
		if (matchUrlPattern(url, pattern)) return true;
	}

	return false;
}

/**
 * Match a URL against a glob-like pattern.
 * Supports ** for path wildcards and * for single segment wildcards.
 */
function matchUrlPattern(url: string, pattern: string): boolean {
	// Normalize: ensure trailing slash consistency
	const normalizedUrl = url.endsWith("/") ? url : `${url}/`;
	const normalizedPattern = pattern.endsWith("/**")
		? pattern
		: pattern.endsWith("/")
			? `${pattern}**`
			: pattern;

	// Convert glob pattern to regex
	// Replace ** first (matches across path segments), then * (single segment)
	const escaped = normalizedPattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "___DOUBLE_STAR___")
		.replace(/\*/g, "___SINGLE_STAR___")
		.replace(/___DOUBLE_STAR___/g, ".*")
		.replace(/___SINGLE_STAR___/g, ".*"); // Treat * as ** for URL patterns (more intuitive)

	const regex = new RegExp(`^${escaped}$`);
	return regex.test(url) || regex.test(normalizedUrl);
}

// ── Operation Permission Check ─────────────────────────────────────────────

export type OperationType =
	| "navigation"
	| "click"
	| "type"
	| "submit"
	| "delete"
	| "download"
	| "external_navigation";

/**
 * Check if a specific operation type is allowed.
 */
export function isOperationAllowed(
	operation: OperationType,
	permissions: Permissions,
): boolean {
	return permissions[operation] === "allow";
}

// ── Rate Limiter ───────────────────────────────────────────────────────────

/**
 * Simple sliding window rate limiter for request throttling.
 */
export class RateLimiter {
	private timestamps: number[] = [];
	private readonly maxRequests: number;
	private readonly windowMs: number;

	constructor(maxRequestsPerMinute: number) {
		this.maxRequests = maxRequestsPerMinute;
		this.windowMs = 60_000;
	}

	/**
	 * Check if a request is allowed. If allowed, records the request.
	 * Returns true if the request can proceed.
	 */
	tryRequest(): boolean {
		const now = Date.now();
		const cutoff = now - this.windowMs;

		// Remove expired timestamps
		this.timestamps = this.timestamps.filter((t) => t > cutoff);

		if (this.timestamps.length >= this.maxRequests) {
			return false;
		}

		this.timestamps.push(now);
		return true;
	}

	/**
	 * Get the number of remaining requests in the current window.
	 */
	get remaining(): number {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		const active = this.timestamps.filter((t) => t > cutoff).length;
		return Math.max(0, this.maxRequests - active);
	}

	/**
	 * Reset the rate limiter.
	 */
	reset(): void {
		this.timestamps = [];
	}
}

// ── Loop Detector ──────────────────────────────────────────────────────────

interface LoopAction {
	type: string;
	target: string;
	timestamp: number;
}

/**
 * Detects repetitive operation patterns that indicate agent loops.
 */
export class LoopDetector {
	private actions: LoopAction[] = [];
	private readonly warnThreshold: number;
	private readonly stopThreshold: number;

	constructor(warnThreshold = 3, stopThreshold = 5) {
		this.warnThreshold = warnThreshold;
		this.stopThreshold = stopThreshold;
	}

	/**
	 * Record an action and check for loops.
	 * Returns: "ok" | "warn" | "stop"
	 */
	record(type: string, target: string): "ok" | "warn" | "stop" {
		this.actions.push({ type, target, timestamp: Date.now() });

		// Keep only recent actions (last 20)
		if (this.actions.length > 20) {
			this.actions = this.actions.slice(-20);
		}

		const consecutiveCount = this.countConsecutiveSame();

		if (consecutiveCount >= this.stopThreshold) return "stop";
		if (consecutiveCount >= this.warnThreshold) return "warn";
		return "ok";
	}

	private countConsecutiveSame(): number {
		if (this.actions.length < 2) return 1;

		const last = this.actions[this.actions.length - 1];
		if (!last) return 1;
		let count = 1;

		for (let i = this.actions.length - 2; i >= 0; i--) {
			const action = this.actions[i];
			if (action && action.type === last.type && action.target === last.target) {
				count++;
			} else {
				break;
			}
		}

		return count;
	}

	/**
	 * Reset the detector.
	 */
	reset(): void {
		this.actions = [];
	}
}

// ── Session Timer ──────────────────────────────────────────────────────────

/**
 * Tracks session duration and enforces timeout.
 */
export class SessionTimer {
	private readonly startTime: number;
	private readonly maxDurationMs: number;

	constructor(maxDurationSeconds: number) {
		this.startTime = Date.now();
		this.maxDurationMs = maxDurationSeconds * 1000;
	}

	/**
	 * Check if the session has exceeded its maximum duration.
	 */
	get isExpired(): boolean {
		return Date.now() - this.startTime >= this.maxDurationMs;
	}

	/**
	 * Get remaining time in seconds.
	 */
	get remainingSeconds(): number {
		const remaining = this.maxDurationMs - (Date.now() - this.startTime);
		return Math.max(0, Math.round(remaining / 1000));
	}

	/**
	 * Get elapsed time in seconds.
	 */
	get elapsedSeconds(): number {
		return Math.round((Date.now() - this.startTime) / 1000);
	}
}

// ── Dry Run Logger ─────────────────────────────────────────────────────────

export interface DryRunEntry {
	timestamp: string;
	operation: OperationType;
	target: string;
	url: string;
	wouldExecute: boolean;
	reason?: string;
}

/**
 * Records operations that would be executed in a dry run.
 */
export class DryRunLogger {
	private entries: DryRunEntry[] = [];

	log(
		operation: OperationType,
		target: string,
		url: string,
		wouldExecute: boolean,
		reason?: string,
	): void {
		this.entries.push({
			timestamp: new Date().toISOString(),
			operation,
			target,
			url,
			wouldExecute,
			reason,
		});
	}

	getEntries(): DryRunEntry[] {
		return [...this.entries];
	}

	toJson(): string {
		return JSON.stringify(this.entries, null, 2);
	}

	clear(): void {
		this.entries = [];
	}
}

// ── In-source Tests ────────────────────────────────────────────────────

if (import.meta.vitest) {
	const { describe, it, expect } = import.meta.vitest;

	const makePermissions = (overrides?: Partial<Permissions>): Permissions => ({
		navigation: "allow", click: "allow", type: "allow", submit: "allow",
		delete: "deny", download: "deny", external_navigation: "deny",
		max_requests_per_minute: 30, max_session_duration: 600,
		url_allowlist: ["https://staging.example.com/**"],
		url_denylist: ["*/admin/**"],
		...overrides,
	});

	describe("isUrlAllowed", () => {
		it("allows URLs matching allowlist", () => {
			const perms = makePermissions();
			expect(isUrlAllowed("https://staging.example.com/login", perms)).toBe(true);
			expect(isUrlAllowed("https://staging.example.com/dashboard/settings", perms)).toBe(true);
		});

		it("allows base URL with ** pattern", () => {
			const perms = makePermissions();
			expect(isUrlAllowed("https://staging.example.com", perms)).toBe(true);
		});

		it("denies URLs matching denylist", () => {
			const perms = makePermissions();
			expect(isUrlAllowed("https://staging.example.com/admin/users", perms)).toBe(false);
		});

		it("denies URLs not in allowlist", () => {
			const perms = makePermissions();
			expect(isUrlAllowed("https://evil.com/phishing", perms)).toBe(false);
		});
	});

	describe("isOperationAllowed", () => {
		it("allows permitted operations", () => {
			const perms = makePermissions();
			expect(isOperationAllowed("navigation", perms)).toBe(true);
			expect(isOperationAllowed("click", perms)).toBe(true);
		});

		it("denies forbidden operations", () => {
			const perms = makePermissions();
			expect(isOperationAllowed("delete", perms)).toBe(false);
			expect(isOperationAllowed("download", perms)).toBe(false);
		});
	});

	describe("RateLimiter", () => {
		it("allows requests within limit", () => {
			const limiter = new RateLimiter(5);
			for (let i = 0; i < 5; i++) {
				expect(limiter.tryRequest()).toBe(true);
			}
		});

		it("rejects requests over limit", () => {
			const limiter = new RateLimiter(3);
			expect(limiter.tryRequest()).toBe(true);
			expect(limiter.tryRequest()).toBe(true);
			expect(limiter.tryRequest()).toBe(true);
			expect(limiter.tryRequest()).toBe(false);
		});

		it("tracks remaining count", () => {
			const limiter = new RateLimiter(5);
			expect(limiter.remaining).toBe(5);
			limiter.tryRequest();
			expect(limiter.remaining).toBe(4);
		});
	});

	describe("LoopDetector", () => {
		it("returns ok for non-repeating actions", () => {
			const detector = new LoopDetector();
			expect(detector.record("click", "btn1")).toBe("ok");
			expect(detector.record("click", "btn2")).toBe("ok");
			expect(detector.record("type", "input1")).toBe("ok");
		});

		it("warns on repeated actions", () => {
			const detector = new LoopDetector(3, 5);
			detector.record("click", "btn1");
			detector.record("click", "btn1");
			expect(detector.record("click", "btn1")).toBe("warn");
		});

		it("stops on excessive loops", () => {
			const detector = new LoopDetector(3, 5);
			for (let i = 0; i < 4; i++) detector.record("click", "btn1");
			expect(detector.record("click", "btn1")).toBe("stop");
		});
	});

	describe("SessionTimer", () => {
		it("is not expired immediately", () => {
			const timer = new SessionTimer(600);
			expect(timer.isExpired).toBe(false);
			expect(timer.remainingSeconds).toBeGreaterThan(598);
		});
	});
}
