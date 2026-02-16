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

# Run with a real LLM
export ANTHROPIC_API_KEY=sk-ant-...
clawfooding run --scenario examples/scenario-basic.yaml

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
| `OPENAI_BASE_URL` | Custom endpoint (Ollama, LM Studio, etc.) |
| `CLAWFOODING_DEFAULT_MODEL` | Default model (e.g. `anthropic/claude-sonnet-4-5`) |
| `CLAWFOODING_TARGET_URL` | Target site URL |

Use `--simulate` to run without any API key.

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
