/**
 * Ambient declaration for the optional `playwright` dependency.
 * playwright is NOT bundled with clawfooding; it must be installed separately.
 * This declaration allows `feelfree` to import it dynamically without
 * TypeScript raising TS2307.
 */
declare module "playwright" {
	interface Page {
		goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
		waitForTimeout(ms: number): Promise<void>;
		evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
		close(): Promise<void>;
	}

	interface Browser {
		newPage(): Promise<Page>;
		close(): Promise<void>;
	}

	interface BrowserType {
		launch(options?: { headless?: boolean }): Promise<Browser>;
	}

	const chromium: BrowserType;
	const firefox: BrowserType;
	const webkit: BrowserType;
}
