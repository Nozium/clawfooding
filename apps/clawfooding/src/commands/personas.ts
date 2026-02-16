import * as path from "node:path";
import { define } from "gunshi";
import pc from "picocolors";
import { loadPersona, listPersonas, generateSoulMd } from "@clawfooding/core/persona";
import {
	fittsMovementTime,
	hickDecisionTime,
	misclickProbability,
	formInputErrorProbability,
	abandonmentProbability,
} from "@clawfooding/core/cognitive";
import { Table } from "@clawfooding/terminal/table";
import { sharedArgs } from "../_shared-args.ts";

export const personasCommandDef = define({
	args: {
		...sharedArgs,
		list: {
			type: "boolean",
			short: "l",
			default: false,
			description: "List all available personas",
		},
		inspect: {
			type: "string",
			short: "i",
			description: "Inspect a specific persona (show cognitive parameters)",
		},
		soul: {
			type: "string",
			description: "Generate SOUL.md for a persona",
		},
	},
	run: async (ctx) => {
		const { list, inspect, soul, json, personas_dir } = ctx.values;

		if (soul) {
			const { id, persona } = await loadPersona(soul);
			const soulMd = generateSoulMd(id, persona);
			console.log(soulMd);
			return;
		}

		if (inspect) {
			await inspectPersona(inspect, json ?? false);
			return;
		}

		// Default: list
		await listAllPersonas(personas_dir, json ?? false);
	},
});

async function listAllPersonas(dir: string | undefined, json: boolean): Promise<void> {
	const personas = await listPersonas(dir);

	if (personas.length === 0) {
		console.log(pc.yellow("No personas found."));
		console.log(pc.dim("Place persona YAML files in the personas/ directory."));
		return;
	}

	if (json) {
		console.log(JSON.stringify(personas, null, 2));
		return;
	}

	console.log(pc.bold("\n── Available Personas ──\n"));

	const table = new Table({
		columns: [
			{ header: "ID", width: 12, align: "left" },
			{ header: "Name", width: 30, align: "left" },
			{ header: "Description", width: 50, align: "left" },
		],
	});

	for (const p of personas) {
		table.addRow([
			String(p.id),
			p.name,
			p.description.length > 50 ? `${p.description.slice(0, 49)}…` : p.description,
		]);
	}

	console.log(table.render());
}

async function inspectPersona(nameOrPath: string, json: boolean): Promise<void> {
	const { id, persona } = await loadPersona(nameOrPath);

	if (json) {
		console.log(JSON.stringify({ id, persona }, null, 2));
		return;
	}

	console.log(pc.bold(`\n── Persona: ${persona.name} ──\n`));

	if (persona.description) {
		console.log(pc.dim(persona.description));
		console.log("");
	}

	// Demographics
	console.log(pc.bold("Demographics:"));
	console.log(`  Age:           ${persona.demographics.age}`);
	console.log(`  Tech Level:    ${persona.demographics.tech_level}`);
	console.log(`  Device:        ${persona.demographics.device}`);
	console.log(`  Language:      ${persona.demographics.language}`);
	console.log(`  Accessibility: ${persona.demographics.accessibility}`);
	console.log("");

	// Cognitive Profile
	console.log(pc.bold("Cognitive Profile:"));
	console.log(`  Navigation:    ${persona.cognitive_profile.navigation_strategy}`);
	console.log(`  Processing:    ${persona.cognitive_profile.information_processing}`);
	console.log(`  Risk:          ${persona.cognitive_profile.risk_tolerance}`);
	console.log(`  Error Recovery:${persona.cognitive_profile.error_recovery}`);
	console.log(`  Reading:       ${persona.cognitive_profile.reading_pattern}`);
	console.log(`  Working Mem:   ${persona.cognitive_profile.working_memory_load} chunks`);
	console.log(`  Attention:     ${persona.cognitive_profile.attention_span}`);
	console.log(`  Decision:      ${persona.cognitive_profile.decision_speed}`);
	console.log("");

	// Motor Profile
	console.log(pc.bold("Motor Profile:"));
	console.log(`  Precision:     ${persona.motor_profile.pointer_precision}`);
	console.log(`  Click Speed:   ${persona.motor_profile.click_speed_ms}ms`);
	console.log(`  Scroll:        ${persona.motor_profile.scroll_behavior}`);
	console.log(`  Tap Offset:    ${persona.motor_profile.tap_accuracy_offset_px}px`);
	console.log("");

	// Context
	console.log(pc.bold("Context:"));
	console.log(`  Motivation:    ${persona.context.motivation}`);
	console.log(`  Time Pressure: ${persona.context.time_pressure}`);
	console.log(`  Familiarity:   ${persona.context.familiarity}`);
	console.log(`  Emotion:       ${persona.context.emotional_state}`);
	console.log(`  Environment:   ${persona.context.environment}`);
	console.log("");

	// Derived cognitive metrics
	console.log(pc.bold("Derived Metrics (simulated):"));

	const fitts = fittsMovementTime(300, 44, persona.motor_profile);
	console.log(`  Fitts' movement (300px→44px btn): ${Math.round(fitts)}ms`);

	const hick = hickDecisionTime(7, persona.cognitive_profile);
	console.log(`  Hick's decision (7 choices):      ${Math.round(hick)}ms`);

	const misclick = misclickProbability(300, 44, persona.motor_profile);
	console.log(`  Misclick probability:              ${(misclick * 100).toFixed(1)}%`);

	const formErr = formInputErrorProbability(10, persona.cognitive_profile);
	console.log(`  Form error (10 fields):            ${(formErr * 100).toFixed(1)}%`);

	const abandon = abandonmentProbability(800, persona.cognitive_profile);
	console.log(`  Abandonment (800ms load):          ${(abandon * 100).toFixed(1)}%`);
	console.log("");
}
