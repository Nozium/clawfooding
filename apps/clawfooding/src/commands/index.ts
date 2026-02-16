import { cli } from "gunshi";
import { CLI_DESCRIPTION, CLI_NAME, CLI_VERSION } from "../_consts.ts";
import { mainCommand, subCommandUnion } from "./_registry.ts";

const subCommands = new Map<string, unknown>();
for (const [name, command] of subCommandUnion) {
	subCommands.set(name, command);
}

export async function run(): Promise<void> {
	let args = process.argv.slice(2);
	if (args[0] === CLI_NAME) {
		args = args.slice(1);
	}

	await cli(args, mainCommand, {
		name: CLI_NAME,
		version: CLI_VERSION,
		description: CLI_DESCRIPTION,
		subCommands: subCommands as never,
		renderHeader: null,
	});
}
