import type {
	CognitiveProfile,
	DecisionSpeed,
	MotorProfile,
	PointerPrecision,
	ReadingPattern,
} from "./_types.ts";

// ── Fitts' Law ─────────────────────────────────────────────────────────────

interface FittsParams {
	/** Intercept (ms) - base movement time */
	a: number;
	/** Slope (ms/bit) - movement time per bit of difficulty */
	b: number;
}

const FITTS_PARAMS: Record<PointerPrecision, FittsParams> = {
	low: { a: 200, b: 150 },
	medium: { a: 120, b: 100 },
	high: { a: 50, b: 80 },
};

/**
 * Calculate movement time using Fitts' Law.
 * T = a + b * log2(1 + D/W)
 *
 * @param distance - Distance to target in pixels
 * @param targetWidth - Width of the target in pixels
 * @param motor - Motor profile of the persona
 * @returns Movement time in milliseconds
 */
export function fittsMovementTime(
	distance: number,
	targetWidth: number,
	motor: MotorProfile,
): number {
	const params = FITTS_PARAMS[motor.pointer_precision];
	const id = Math.log2(1 + distance / Math.max(targetWidth, 1));
	return params.a + params.b * id;
}

/**
 * Calculate Fitts' Index of Difficulty for a target.
 * ID = log2(2D/W)
 */
export function fittsIndexOfDifficulty(
	distance: number,
	targetWidth: number,
): number {
	return Math.log2((2 * distance) / Math.max(targetWidth, 1));
}

/**
 * Calculate misclick probability based on Fitts' Law parameters.
 * P(error) = base_rate * (1 / target_width) * distance_factor
 */
export function misclickProbability(
	distance: number,
	targetWidth: number,
	motor: MotorProfile,
): number {
	const baseRates: Record<PointerPrecision, number> = {
		low: 0.15,
		medium: 0.06,
		high: 0.02,
	};

	const baseRate = baseRates[motor.pointer_precision];
	const distanceFactor = Math.min(distance / 500, 2.0);
	const sizeFactor = 40 / Math.max(targetWidth, 10);

	return Math.min(baseRate * sizeFactor * distanceFactor, 0.8);
}

// ── Hick's Law ─────────────────────────────────────────────────────────────

const HICK_COEFFICIENTS: Record<DecisionSpeed, number> = {
	slow: 600,
	medium: 350,
	fast: 150,
};

/**
 * Calculate decision time using Hick's Law.
 * T = b * log2(n + 1)
 *
 * @param choiceCount - Number of available choices
 * @param cognitive - Cognitive profile of the persona
 * @returns Decision time in milliseconds
 */
export function hickDecisionTime(
	choiceCount: number,
	cognitive: CognitiveProfile,
): number {
	const b = HICK_COEFFICIENTS[cognitive.decision_speed];
	return b * Math.log2(choiceCount + 1);
}

// ── Miller's Number ────────────────────────────────────────────────────────

/**
 * Calculate form input error probability based on working memory load.
 * P(error) = base_rate * (field_count / working_memory_load)
 *
 * Error rate increases sharply when field count exceeds working memory capacity.
 */
export function formInputErrorProbability(
	fieldCount: number,
	cognitive: CognitiveProfile,
): number {
	const baseRate = 0.05;
	const loadRatio = fieldCount / cognitive.working_memory_load;

	if (loadRatio <= 1.0) return baseRate * loadRatio;
	// Exponential increase beyond working memory capacity
	return Math.min(baseRate * loadRatio ** 2, 0.6);
}

// ── Visual Scanning Patterns ───────────────────────────────────────────────

export interface ElementPosition {
	x: number;
	y: number;
	width: number;
	height: number;
	label: string;
}

export interface ScanResult {
	/** Elements in scan order */
	scanOrder: ElementPosition[];
	/** Elements likely to be skipped */
	skippedElements: ElementPosition[];
	/** Coverage percentage (0-100) */
	coverage: number;
}

/**
 * Simulate visual scanning of page elements based on reading pattern.
 *
 * @param elements - All interactive elements on the page
 * @param pattern - Reading pattern from persona's cognitive profile
 * @param viewportWidth - Viewport width in pixels
 * @param viewportHeight - Viewport height in pixels
 */
export function simulateVisualScan(
	elements: ElementPosition[],
	pattern: ReadingPattern,
	viewportWidth: number,
	viewportHeight: number,
): ScanResult {
	const scanners: Record<ReadingPattern, () => ScanResult> = {
		f_pattern: () => fPatternScan(elements, viewportWidth, viewportHeight),
		z_pattern: () => zPatternScan(elements, viewportWidth, viewportHeight),
		scanning: () => scanningPatternScan(elements),
		linear: () => linearScan(elements),
	};

	return scanners[pattern]();
}

function fPatternScan(
	elements: ElementPosition[],
	viewportWidth: number,
	viewportHeight: number,
): ScanResult {
	// F-pattern: top bar → left column → decreasing horizontal scans
	const scanned: ElementPosition[] = [];
	const skipped: ElementPosition[] = [];

	for (const el of elements) {
		const relX = el.x / viewportWidth;
		const relY = el.y / viewportHeight;

		// Top 20%: full horizontal scan
		if (relY < 0.2) {
			scanned.push(el);
		}
		// Left 40%: vertical scan
		else if (relX < 0.4) {
			scanned.push(el);
		}
		// Middle band: diminishing attention
		else if (relY < 0.5 && relX < 0.7) {
			if (Math.random() < 0.6) scanned.push(el);
			else skipped.push(el);
		}
		// Bottom-right: high skip probability
		else {
			if (Math.random() < 0.2) scanned.push(el);
			else skipped.push(el);
		}
	}

	return {
		scanOrder: scanned,
		skippedElements: skipped,
		coverage: elements.length > 0 ? (scanned.length / elements.length) * 100 : 100,
	};
}

function zPatternScan(
	elements: ElementPosition[],
	viewportWidth: number,
	viewportHeight: number,
): ScanResult {
	// Z-pattern: top-left → top-right → bottom-left → bottom-right (diagonal)
	const scanned: ElementPosition[] = [];
	const skipped: ElementPosition[] = [];

	for (const el of elements) {
		const relX = el.x / viewportWidth;
		const relY = el.y / viewportHeight;

		// On the Z path: corners and diagonal
		const onZPath =
			(relY < 0.2) || // top
			(relY > 0.8) || // bottom
			Math.abs(relX - (1 - relY)) < 0.2; // diagonal

		if (onZPath) {
			scanned.push(el);
		} else if (Math.random() < 0.35) {
			scanned.push(el);
		} else {
			skipped.push(el);
		}
	}

	return {
		scanOrder: scanned,
		skippedElements: skipped,
		coverage: elements.length > 0 ? (scanned.length / elements.length) * 100 : 100,
	};
}

function scanningPatternScan(elements: ElementPosition[]): ScanResult {
	// Scanning: only reads headings, bold elements, links - skips body text
	const scanned: ElementPosition[] = [];
	const skipped: ElementPosition[] = [];

	for (const el of elements) {
		// Heuristic: interactive elements and elements with short labels are noticed
		const isNoticed = el.label.length < 30 || el.width > 100;
		if (isNoticed) {
			scanned.push(el);
		} else {
			if (Math.random() < 0.15) scanned.push(el);
			else skipped.push(el);
		}
	}

	return {
		scanOrder: scanned,
		skippedElements: skipped,
		coverage: elements.length > 0 ? (scanned.length / elements.length) * 100 : 100,
	};
}

function linearScan(elements: ElementPosition[]): ScanResult {
	// Linear: reads everything top to bottom. Slow but thorough.
	const sorted = [...elements].sort((a, b) => {
		if (Math.abs(a.y - b.y) < 20) return a.x - b.x;
		return a.y - b.y;
	});

	return {
		scanOrder: sorted,
		skippedElements: [],
		coverage: 100,
	};
}

// ── Doherty Threshold ──────────────────────────────────────────────────────

/**
 * Calculate probability of user abandoning action due to slow response.
 * Based on Doherty Threshold (400ms).
 */
export function abandonmentProbability(
	responseTimeMs: number,
	cognitive: CognitiveProfile,
): number {
	if (responseTimeMs <= 400) return 0;

	const attentionFactors: Record<string, number> = {
		short: 0.3,
		medium: 0.15,
		high: 0.05,
	};

	const factor = attentionFactors[cognitive.attention_span] ?? 0.15;
	const excessTime = (responseTimeMs - 400) / 1000;
	return Math.min(factor * excessTime, 0.8);
}

// ── Serial Position Effect ─────────────────────────────────────────────────

/**
 * Calculate skip probability for items in a list based on serial position effect.
 * Items at the beginning (primacy) and end (recency) are remembered better.
 */
export function serialPositionSkipProbability(
	index: number,
	totalItems: number,
): number {
	if (totalItems <= 3) return 0;

	const position = index / (totalItems - 1); // Normalize to 0-1
	// U-shaped curve: low skip probability at start and end, high in middle
	const middleness = 1 - 4 * (position - 0.5) ** 2;
	return Math.min(middleness * 0.4, 0.5);
}

// ── Cognitive Load Score ───────────────────────────────────────────────────

/**
 * Calculate cognitive load score for a page (0-100).
 *
 * Considers:
 * - Number of interactive elements (Hick's Law)
 * - Form field count (Miller's Number)
 * - Visual complexity (element density)
 */
export function cognitiveLoadScore(
	interactiveElementCount: number,
	formFieldCount: number,
	totalElementCount: number,
	viewportArea: number,
): number {
	const hickComponent = Math.min((Math.log2(interactiveElementCount + 1) / 5) * 30, 30);
	const millerComponent = Math.min((formFieldCount / 7) * 35, 35);
	const densityComponent = Math.min(
		((totalElementCount / Math.max(viewportArea / 10000, 1)) * 10) * 35,
		35,
	);

	return Math.round(hickComponent + millerComponent + densityComponent);
}
