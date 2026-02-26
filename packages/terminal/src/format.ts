import pc from "picocolors";

/**
 * Format a USD cost value with appropriate precision.
 */
export function formatCurrency(usd: number): string {
	if (usd === 0) return "$0.00";
	if (usd < 0.001) return `$${usd.toFixed(6)}`;
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

/**
 * Format a token count with thousands separators.
 */
export function formatTokens(count: number): string {
	if (count === 0) return "0";
	return count.toLocaleString("en-US");
}

/**
 * Format a percentage value.
 */
export function formatPercentage(value: number): string {
	if (value === 0) return "0%";
	if (value < 1) return `${value.toFixed(2)}%`;
	return `${value.toFixed(1)}%`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m${seconds}s`;
}

/**
 * Colorize a cost value: green for low, yellow for medium, red for high.
 */
export function colorizeCost(usd: number): string {
	const formatted = formatCurrency(usd);
	if (usd < 0.01) return pc.green(formatted);
	if (usd < 0.1) return pc.yellow(formatted);
	return pc.red(formatted);
}

/**
 * Colorize a percentage: red for high, yellow for medium, green for low.
 */
export function colorizePercentage(value: number): string {
	const formatted = formatPercentage(value);
	if (value > 50) return pc.red(formatted);
	if (value > 25) return pc.yellow(formatted);
	return pc.green(formatted);
}

/**
 * Truncate a string to a maximum length, adding ellipsis.
 */
export function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 1)}…`;
}
