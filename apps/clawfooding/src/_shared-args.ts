import type { Args } from "gunshi";

export const sharedArgs = {
	json: {
		type: "boolean",
		short: "j",
		default: false,
		description: "Output results as JSON",
	},
	debug: {
		type: "boolean",
		short: "d",
		default: false,
		description: "Enable debug logging",
	},
	config: {
		type: "string",
		short: "c",
		description: "Path to scenario configuration file",
	},
	personas_dir: {
		type: "string",
		description: "Directory containing persona YAML files",
	},
} as const satisfies Args;
