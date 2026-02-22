# ClawFooding

AI cognitive pattern testing CLI. Simulates diverse user personas (with cognitive/motor profiles) against your web app to find UX issues before real users do.

## Install

### Nix (recommended)

Requires [Nix](https://nixos.org/download/) with Flakes enabled.

```bash
# Enable Flakes (one-time setup)
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Build and run
nix build github:Nozium/clawfooding
./result/bin/clawfooding --help

# Or install to your profile
nix profile install github:Nozium/clawfooding
clawfooding --help
```

> **First build:** `npmDepsHash` needs to be computed. Run `nix build` once — it will fail and print the correct `sha256-...` hash. Replace `lib.fakeHash` in `flake.nix` with that value, then rebuild.

### pnpm (manual)

Requires Node.js 22+ and pnpm 10.8.1+.

```bash
git clone https://github.com/Nozium/clawfooding.git
cd clawfooding
pnpm install
pnpm run build
node apps/clawfooding/dist/index.mjs --help
```

## Quick Start

```bash
# List available personas
clawfooding personas --list

# Inspect a persona's cognitive profile
clawfooding personas --inspect haruka

# Run a scenario in simulate mode (no API key needed)
clawfooding run --scenario examples/scenario-basic.yaml --simulate

# Start interactive Codex OAuth login
clawfooding --login codex

# Remote machine fallback (manual token paste)
clawfooding --login codex:device
# (tries importing from ~/.codex/auth.json first, then prompts if needed)

# Save credentials into .env (provider=credential)
clawfooding --login codex=<oauth-token>
clawfooding --login openai=<api-key>
clawfooding --login anthropic=<api-key>

# Run with a real LLM
export ANTHROPIC_API_KEY=sk-ant-...
clawfooding run --scenario examples/scenario-basic.yaml

# Override defender permission for a run (default is block)
clawfooding run --scenario examples/scenario-basic.yaml --defender-mode warn

# Benchmark across models
clawfooding bench --scenario examples/scenario-basic.yaml \
  --models "anthropic/claude-sonnet-4-5,anthropic/claude-haiku-4-5"

# View billing report
clawfooding billing --dir .clawfooding/billing
clawfooding billing --dir .clawfooding/billing --group-by daily
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude models) |
| `OPENAI_API_KEY` | OpenAI API key (for GPT models) |
| `OPENAI_OAUTH_TOKEN` | OpenAI/Codex OAuth token (ChatGPT subscription auth) |
| `OPENAI_BASE_URL` | Custom endpoint (Ollama, LM Studio, etc.) |
| `CLAWFOODING_DEFENDER_MODE` | Outbound guard mode: `off`, `warn`, `block` (default: `block`) |
| `CLAWFOODING_DEFAULT_MODEL` | Default model (e.g. `anthropic/claude-sonnet-4-5`) |
| `CLAWFOODING_TARGET_URL` | Target site URL |

Use `--simulate` to run without any API key.

### Automatic Model Selection

ClawFooding automatically selects the best available model based on your API keys:

1. **OpenAI/Codex OAuth** (`OPENAI_OAUTH_TOKEN`) → `openai/gpt-5.3-codex`
2. **OpenAI API Key** (`OPENAI_API_KEY`) → `openai/gpt-4o`
3. **Anthropic API Key** (`ANTHROPIC_API_KEY`) → `anthropic/claude-sonnet-4-5`

You can always override this with `--model`:

```bash
# Auto-detected based on available API keys
clawfooding feelfree --url https://www.google.com --goal "AI trends"

# Explicitly specify model
clawfooding feelfree --url https://www.google.com --goal "AI trends" --model openai/gpt-4o
```

Available Codex models (via `OPENAI_OAUTH_TOKEN`):
- `openai/gpt-5.3-codex` — Latest frontier agentic coding model (default for Codex)
- `openai/gpt-5.2-codex` — Frontier agentic coding model
- `openai/gpt-5.1-codex-max` — Codex-optimized flagship for deep and fast reasoning
- `openai/gpt-5.2` — Latest frontier model with improvements across knowledge, reasoning and coding
- `openai/gpt-5.1-codex-mini` — Faster, smaller Codex model

## Security Considerations

### API Key Storage

Credentials saved via `--login` are written to `.env` in plaintext. This file is excluded from version control via `.gitignore`, but:

- Anyone with filesystem read access can read the keys directly.
- Prefer using environment variables (`export ANTHROPIC_API_KEY=...`) in CI/CD pipelines rather than `.env` files.
- For shared machines, set restrictive file permissions: `chmod 600 .env`.

### Defender Mode

The `--defender-mode` flag (default: `block`) guards LLM outputs against credential leakage and prompt injection. **Do not set `--defender-mode off` in production or shared environments.** The `warn` mode logs findings without blocking—useful for debugging, not for production runs.

The optional `openclaw-defender` npm package can be added for enhanced protection beyond the built-in regex rules:

```bash
pnpm add openclaw-defender
```

When present, it is loaded automatically and takes precedence over the built-in detector.

### `feelfree` Browser Automation

The `feelfree` command launches a headless Chromium browser via [Playwright](https://playwright.dev/) to perform live Google searches. Be aware of the following risks:

- **Google Terms of Service**: Automated scraping of Google Search results may violate Google's ToS. Use `--simulate` for development and testing to avoid live requests.
- **Fragile DOM selectors**: Google changes its HTML structure frequently. The `div#search .g` selectors used for result extraction may break without notice. If no results are returned, check the selectors in `apps/clawfooding/src/commands/feelfree.ts`.
- **Playwright is an optional dependency**: The Nix package does NOT include Playwright. Use `--simulate` mode when running via `nix profile install`. For real browser mode, use the development environment: `pnpm install && bun apps/clawfooding/src/index.ts feelfree ...`
- **Network requests**: Live mode sends real HTTP requests to Google from your IP address. Rate-limited or blocked IPs will return empty results.

### Billing Log Privacy

Billing JSONL logs stored in `.clawfooding/billing/` contain persona IDs, step descriptions, token counts, and timestamps but **no LLM response content**. LLM response text is processed in memory and filtered by the defender before any output is shown. Logs are safe to retain for cost tracking.

### OpenClaw Integration

When using `clawfooding personas --soul <name>` to generate SOUL.md files for [OpenClaw](https://openclaw.ai), the output contains persona behavioral profiles. These files do not contain credentials or secrets and are safe to commit.

## Development

```bash
# Enter Nix dev shell (installs pnpm, bun, etc.)
nix develop

# Or use pnpm directly
pnpm install
pnpm run build
pnpm run test
pnpm typecheck
```

See [CLAUDE.md](./CLAUDE.md) for detailed development conventions.
