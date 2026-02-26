/**
 * Optional external dependency. If installed, it is loaded dynamically at
 * runtime by defender.ts and takes precedence over the built-in detector.
 * This declaration prevents TS2307 when the package is absent.
 *
 * Matches openclaw-defender@0.3.x public API.
 */
declare module "openclaw-defender" {
	export interface ScanFinding {
		layer?: number;
		ruleId: string;
		category: string;
		severity: string;
		message: string;
		evidence?: string;
		confidence?: number;
		position?: { start: number; end: number };
	}

	export interface ScanResult {
		input: string;
		normalized: string;
		findings: ScanFinding[];
		/** "block" | "log" | "allow" */
		action: string;
		blocked: boolean;
		durationMs: number;
		timestamp: string;
	}

	export interface Scanner {
		scanSync(text: string): ScanResult;
		scan(text: string): Promise<ScanResult>;
	}

	export function createScanner(config: Record<string, unknown>): Scanner;

	/** Low-level sync scan (generic integration) */
	export function scanSync(text: string, config?: Record<string, unknown>): ScanResult;
	/** Low-level async scan (generic integration) */
	export function scan(text: string, config?: Record<string, unknown>): Promise<ScanResult>;
}
