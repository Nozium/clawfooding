import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as v from "valibot";
import YAML from "yaml";
import {
	type Persona,
	type PersonaId,
	createPersonaId,
	personaSchema,
} from "./_types.ts";

/** Default directory for built-in personas */
const PERSONAS_DIR = path.resolve(import.meta.dirname ?? ".", "../../personas");

/**
 * Load a persona from a YAML file.
 * Accepts either a full path or a persona name (resolved from the personas/ directory).
 */
export async function loadPersona(nameOrPath: string): Promise<{ id: PersonaId; persona: Persona }> {
	const filePath = await resolvePersonaPath(nameOrPath);
	const content = await fs.readFile(filePath, "utf-8");
	const raw = YAML.parse(content) as unknown;
	const persona = v.parse(personaSchema, raw);
	const id = createPersonaId(
		path.basename(filePath, path.extname(filePath)),
	);
	return { id, persona };
}

/**
 * List all available personas from the personas/ directory.
 */
export async function listPersonas(
	dir?: string,
): Promise<Array<{ id: PersonaId; name: string; description: string }>> {
	const personasDir = dir ?? PERSONAS_DIR;
	const entries = await fs.readdir(personasDir).catch(() => []);
	const results: Array<{ id: PersonaId; name: string; description: string }> = [];

	for (const entry of entries) {
		if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
		const filePath = path.join(personasDir, entry);
		const content = await fs.readFile(filePath, "utf-8");
		const raw = YAML.parse(content) as Record<string, unknown>;
		results.push({
			id: createPersonaId(path.basename(entry, path.extname(entry))),
			name: (raw.name as string) ?? entry,
			description: (raw.description as string) ?? "",
		});
	}

	return results;
}

/**
 * Resolve a persona name or path to an absolute file path.
 */
async function resolvePersonaPath(nameOrPath: string): Promise<string> {
	// If it looks like a path (has extension or separator), use directly
	if (nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.includes(".")) {
		const resolved = path.resolve(nameOrPath);
		await fs.access(resolved);
		return resolved;
	}

	// Try built-in personas directory
	for (const ext of [".yaml", ".yml"]) {
		const candidate = path.join(PERSONAS_DIR, `${nameOrPath}${ext}`);
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// continue
		}
	}

	// Try current directory
	for (const ext of [".yaml", ".yml"]) {
		const candidate = path.resolve(`${nameOrPath}${ext}`);
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// continue
		}
	}

	throw new Error(
		`Persona "${nameOrPath}" not found. Searched in ${PERSONAS_DIR} and current directory.`,
	);
}

/**
 * Generate a SOUL.md string from a Persona definition.
 * This is the format used by OpenClaw for agent personality configuration.
 */
export function generateSoulMd(id: PersonaId, persona: Persona): string {
	const lines: string[] = [
		`# ClawFooding Persona: ${persona.name}`,
		"",
	];

	if (persona.description) {
		lines.push(persona.description, "");
	}

	lines.push("## Demographics");
	lines.push(`age: ${persona.demographics.age}`);
	lines.push(`tech_level: ${persona.demographics.tech_level}`);
	lines.push(`device: ${persona.demographics.device}`);
	lines.push(`language: ${persona.demographics.language}`);
	lines.push(`accessibility: ${persona.demographics.accessibility}`);
	lines.push("");

	lines.push("## Cognitive Profile");
	lines.push(`navigation_strategy: ${persona.cognitive_profile.navigation_strategy}`);
	lines.push(`information_processing: ${persona.cognitive_profile.information_processing}`);
	lines.push(`risk_tolerance: ${persona.cognitive_profile.risk_tolerance}`);
	lines.push(`error_recovery: ${persona.cognitive_profile.error_recovery}`);
	lines.push(`reading_pattern: ${persona.cognitive_profile.reading_pattern}`);
	lines.push(`working_memory_load: ${persona.cognitive_profile.working_memory_load}`);
	lines.push(`attention_span: ${persona.cognitive_profile.attention_span}`);
	lines.push(`decision_speed: ${persona.cognitive_profile.decision_speed}`);
	lines.push("");

	lines.push("## Motor Profile");
	lines.push(`pointer_precision: ${persona.motor_profile.pointer_precision}`);
	lines.push(`click_speed_ms: ${persona.motor_profile.click_speed_ms}`);
	lines.push(`scroll_behavior: ${persona.motor_profile.scroll_behavior}`);
	lines.push(`tap_accuracy_offset_px: ${persona.motor_profile.tap_accuracy_offset_px}`);
	lines.push("");

	lines.push("## Context");
	lines.push(`motivation: ${persona.context.motivation}`);
	lines.push(`time_pressure: ${persona.context.time_pressure}`);
	lines.push(`familiarity: ${persona.context.familiarity}`);
	lines.push(`emotional_state: ${persona.context.emotional_state}`);
	lines.push(`environment: ${persona.context.environment}`);

	return lines.join("\n");
}
