#!/usr/bin/env node

// Load .env from cwd before anything else (no external dotenv dependency)
import * as fs from "node:fs";
import * as path from "node:path";

(function loadDotEnv() {
	const envPath = path.resolve(process.cwd(), ".env");
	let raw: string;
	try {
		raw = fs.readFileSync(envPath, "utf-8");
	} catch {
		return; // no .env file – silently skip
	}
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 1) continue;
		const key = trimmed.slice(0, eq).trim();
		const val = trimmed.slice(eq + 1); // preserve value as-is
		if (key && !(key in process.env)) {
			process.env[key] = val;
		}
	}
})();

import { run } from "./commands/index.ts";

await run();
