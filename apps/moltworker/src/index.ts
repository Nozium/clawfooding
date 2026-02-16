import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiRoutes } from "./routes/api.ts";
import { deployRoutes } from "./routes/deploy.ts";
import { adminRoutes } from "./routes/admin.ts";

export interface Env {
	// Bindings
	REPORTS_BUCKET: R2Bucket;
	BILLING_BUCKET: R2Bucket;
	DB: D1Database;
	BROWSER: Fetcher;
	SESSION_KV: KVNamespace;

	// Secrets
	ANTHROPIC_API_KEY?: string;
	CLOUDFLARE_AI_GATEWAY_API_KEY?: string;
	CF_AI_GATEWAY_ACCOUNT_ID?: string;
	CF_AI_GATEWAY_GATEWAY_ID?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	CLAWFOODING_API_KEY?: string;
	CDP_SECRET?: string;

	// Vars
	ENVIRONMENT: string;
	MAX_SESSION_DURATION: string;
	DEFAULT_MODEL: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ──────────────────────────────────────────────────────────

app.use("*", cors());

// API key authentication for /api routes
app.use("/api/*", async (c, next) => {
	const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
	const expectedKey = c.env.CLAWFOODING_API_KEY;

	if (!expectedKey) {
		return c.json({ error: "API key not configured on server" }, 500);
	}

	if (apiKey !== expectedKey) {
		return c.json({ error: "Invalid API key" }, 401);
	}

	await next();
});

// ── Routes ─────────────────────────────────────────────────────────────

app.route("/api", apiRoutes);
app.route("/api/deploy", deployRoutes);
app.route("/_admin", adminRoutes);

// Health check
app.get("/health", (c) => {
	return c.json({
		status: "ok",
		version: "0.1.0",
		environment: c.env.ENVIRONMENT,
	});
});

// Root
app.get("/", (c) => {
	return c.html(`
		<!DOCTYPE html>
		<html>
		<head><title>ClawFooding Managed Service</title></head>
		<body style="font-family: monospace; max-width: 640px; margin: 40px auto; padding: 0 20px;">
			<h1>🦞 ClawFooding</h1>
			<p>AI Cognitive Pattern Testing - Managed Service</p>
			<ul>
				<li><a href="/health">Health Check</a></li>
				<li><a href="/_admin">Admin Dashboard</a></li>
				<li><code>POST /api/test/run</code> - Run a test</li>
				<li><code>GET /api/test/:id/status</code> - Test status</li>
				<li><code>GET /api/billing</code> - Billing report</li>
				<li><code>POST /api/deploy</code> - Deploy persona test</li>
			</ul>
		</body>
		</html>
	`);
});

export default app;
