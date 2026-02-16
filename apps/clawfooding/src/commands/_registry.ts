import { define } from "gunshi";
import { sharedArgs } from "../_shared-args.ts";
import { runCommandDef } from "./run.ts";
import { billingCommandDef } from "./billing.ts";
import { personasCommandDef } from "./personas.ts";
import { benchCommandDef } from "./bench.ts";

export const mainCommand = define({
	args: sharedArgs,
	run: async (ctx) => {
		// Default: show help
		ctx.showHelp();
	},
});

export const subCommandUnion = [
	["run", runCommandDef],
	["billing", billingCommandDef],
	["personas", personasCommandDef],
	["bench", benchCommandDef],
] as const;
