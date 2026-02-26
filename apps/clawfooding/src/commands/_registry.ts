import { define } from "gunshi";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import pc from "picocolors";
import { sharedArgs } from "../_shared-args.ts";
import { runCommandDef } from "./run.ts";
import { billingCommandDef } from "./billing.ts";
import { personasCommandDef } from "./personas.ts";
import { benchCommandDef } from "./bench.ts";
import { feelfreeCommandDef } from "./feelfree.ts";

type LoginTarget =
	| "ANTHROPIC_API_KEY"
	| "OPENAI_API_KEY"
	| "OPENAI_OAUTH_TOKEN"
	| "ZAI_API_KEY";

function looksLikeJwt(value: string): boolean {
	const parts = value.split(".");
	return parts.length === 3 && parts.every((p) => p.length > 0);
}

function resolveLoginTarget(raw: string): { envVar: LoginTarget; value: string } | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { error: "--login value is empty." };
	}

	const eq = trimmed.indexOf("=");
	const colon = trimmed.indexOf(":");
	const splitAt =
		eq === -1 ? colon :
		colon === -1 ? eq :
		Math.min(eq, colon);

	if (splitAt > 0) {
		const provider = trimmed.slice(0, splitAt).trim().toLowerCase();
		const value = trimmed.slice(splitAt + 1).trim();
		if (!value) {
			return { error: `Missing credential value for provider "${provider}".` };
		}

		switch (provider) {
			case "anthropic":
			case "anthropic_api_key":
				return { envVar: "ANTHROPIC_API_KEY", value };
			case "openai":
			case "openai_api_key":
			case "codex_api_key":
				return { envVar: "OPENAI_API_KEY", value };
			case "codex":
			case "openai-codex":
			case "oauth":
			case "openai_oauth_token":
			case "codex_oauth_token":
				return { envVar: "OPENAI_OAUTH_TOKEN", value };
			case "zai":
			case "glm":
			case "z.ai":
			case "z-ai":
			case "zai_api_key":
			case "z_ai_api_key":
				return { envVar: "ZAI_API_KEY", value };
			default:
				return { error: `Unknown provider "${provider}". Use anthropic/openai/codex/zai.` };
		}
	}

	if (trimmed.startsWith("sk-ant-")) {
		return { envVar: "ANTHROPIC_API_KEY", value: trimmed };
	}
	if (looksLikeJwt(trimmed)) {
		return { envVar: "OPENAI_OAUTH_TOKEN", value: trimmed };
	}
	if (trimmed.startsWith("sk-")) {
		return { envVar: "OPENAI_API_KEY", value: trimmed };
	}

	return {
		error:
			"Could not infer login target. Use --login provider=credential (e.g. codex=..., openai=..., anthropic=..., zai=...).",
	};
}

async function upsertEnvVar(filePath: string, envVar: string, value: string): Promise<void> {
	let content = "";
	try {
		content = await fs.readFile(filePath, "utf-8");
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code !== "ENOENT") {
			throw error;
		}
	}

	const lines = content.length > 0 ? content.split(/\r?\n/) : [];
	const pattern = new RegExp(`^\\s*#?\\s*${envVar}=`);
	const replacement = `${envVar}=${value}`;
	let replaced = false;

	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i] ?? "")) {
			lines[i] = replacement;
			replaced = true;
			break;
		}
	}

	if (!replaced) {
		if (lines.length > 0 && lines[lines.length - 1] !== "") {
			lines.push("");
		}
		lines.push(replacement);
	}

	const output = `${lines.join("\n")}\n`;
	await fs.writeFile(filePath, output, "utf-8");
}

function maskSecret(secret: string): string {
	if (secret.length <= 8) {
		return "*".repeat(secret.length);
	}
	return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

function resolveCodexAuthPath(): string {
	const codexHome = process.env["CODEX_HOME"]?.trim();
	if (codexHome) {
		return path.join(codexHome, "auth.json");
	}
	return path.join(os.homedir(), ".codex", "auth.json");
}

async function loadCodexStoredAccessToken(): Promise<string | null> {
	const authPath = resolveCodexAuthPath();
	try {
		const raw = await fs.readFile(authPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;

		const tokens = (parsed as { tokens?: unknown }).tokens;
		if (!tokens || typeof tokens !== "object") return null;
		const accessToken = (tokens as { access_token?: unknown }).access_token;
		if (typeof accessToken !== "string" || accessToken.trim().length === 0) return null;
		return accessToken.trim();
	} catch {
		return null;
	}
}

async function runCommandInteractive(command: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
		});

		child.on("error", (error) => {
			reject(error);
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
		});
	});
}

async function maybePromptAndSaveOauthToken(envPath: string): Promise<void> {
	const stored = await loadCodexStoredAccessToken();
	if (stored) {
		await upsertEnvVar(envPath, "OPENAI_OAUTH_TOKEN", stored);
		console.log(pc.green(`Imported OPENAI_OAUTH_TOKEN from ${resolveCodexAuthPath()} and saved to ${envPath}`));
		console.log(pc.dim(`OPENAI_OAUTH_TOKEN=${maskSecret(stored)}`));
		return;
	}

	const rl = createInterface({ input, output });
	try {
		const token = (await rl.question("Paste OPENAI_OAUTH_TOKEN to save to .env (Enter to skip): ")).trim();
		if (!token) {
			console.log(pc.yellow("Skipped saving OPENAI_OAUTH_TOKEN."));
			return;
		}
		await upsertEnvVar(envPath, "OPENAI_OAUTH_TOKEN", token);
		console.log(pc.green(`Saved OPENAI_OAUTH_TOKEN to ${envPath}`));
		console.log(pc.dim(`OPENAI_OAUTH_TOKEN=${maskSecret(token)}`));
	} finally {
		rl.close();
	}
}

function printRemoteLoginHint(): void {
	if (!process.env["SSH_CONNECTION"]) {
		return;
	}
	console.log(pc.yellow("Remote session detected (SSH)."));
	console.log(pc.dim("If localhost callback is unreachable, run login through an SSH tunnel from your local machine:"));
	console.log(pc.dim("  ssh -L 1455:localhost:1455 <user>@<remote-host>"));
	console.log(pc.dim("Then run: clawfooding --login codex"));
	console.log("");
}

export const mainCommand = define({
	args: {
		...sharedArgs,
		login: {
			type: "string",
			description: "Login or save credential. Use --login codex (OAuth) or --login codex:device (manual token).",
		},
	},
	run: async (ctx) => {
		const login = ctx.values.login;
		if (typeof login === "string" && login.trim().length > 0) {
			const normalized = login.trim().toLowerCase();
			if (
				normalized === "codex:device" ||
				normalized === "codex-device" ||
				normalized === "openai-codex:device" ||
				normalized === "oauth:device"
				) {
					const envPath = path.resolve(process.cwd(), ".env");
					console.log(pc.bold("Codex device-style login mode"));
					console.log(pc.dim("Will first try importing token from Codex auth store (~/.codex/auth.json)."));
					console.log(pc.dim("If unavailable, complete OAuth on a browser-capable machine and paste OPENAI_OAUTH_TOKEN."));
					await maybePromptAndSaveOauthToken(envPath);
					return;
				}

			if (normalized === "codex" || normalized === "openai-codex" || normalized === "oauth") {
				const envPath = path.resolve(process.cwd(), ".env");
				printRemoteLoginHint();
				console.log(pc.bold("Starting Codex OAuth login..."));
				try {
					await runCommandInteractive("codex", ["login"]);
				} catch (error) {
					const err = error as NodeJS.ErrnoException;
					if (err.code === "ENOENT") {
						console.error(pc.red("Error: 'codex' command not found. Install Codex CLI and retry."));
					} else {
						console.error(pc.red(`Error: ${String(error)}`));
					}
					process.exit(1);
				}
				await maybePromptAndSaveOauthToken(envPath);
				return;
			}

			const resolved = resolveLoginTarget(login);
			if ("error" in resolved) {
				console.error(pc.red(`Error: ${resolved.error}`));
				process.exit(1);
			}

			const envPath = path.resolve(process.cwd(), ".env");
			await upsertEnvVar(envPath, resolved.envVar, resolved.value);
			console.log(pc.green(`Saved ${resolved.envVar} to ${envPath}`));
			console.log(pc.dim(`${resolved.envVar}=${maskSecret(resolved.value)}`));
			return;
		}

		ctx.log("Use --help for available commands.");
	},
});

export const subCommandUnion = [
	["run", runCommandDef],
	["billing", billingCommandDef],
	["personas", personasCommandDef],
	["bench", benchCommandDef],
	["feelfree", feelfreeCommandDef],
] as const;
