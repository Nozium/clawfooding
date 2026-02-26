# ClawFooding Development Guide

## Project Structure

pnpm monorepo with Bun for development, Node.js 22+ for production.

```
apps/
  clawfooding/    # CLI tool (gunshi)
  moltworker/     # Cloudflare Workers managed service (Hono)
packages/
  core/           # Types, persona, cognitive models, billing, security
  terminal/       # Table rendering and formatting
personas/         # Preset persona YAML files
examples/         # Example scenario files
```

## Development

```bash
# Enter Nix dev shell (recommended)
nix develop

# Or use pnpm directly
pnpm install
pnpm run build
pnpm run test
```

### CLI Development
```bash
cd apps/clawfooding
bun ./src/index.ts personas --list
bun ./src/index.ts personas --inspect haruka
bun ./src/index.ts run --scenario ../../examples/scenario-basic.yaml
bun ./src/index.ts billing --dir .clawfooding/billing
bun ./src/index.ts bench --scenario ../../examples/scenario-basic.yaml
```

### MoltWorker Development
```bash
cd apps/moltworker
pnpm run dev    # wrangler dev
pnpm run deploy # wrangler deploy
```

## Conventions

- Internal files: underscore prefix (`_types.ts`, `_consts.ts`)
- Branded types via valibot for domain identifiers
- In-source testing with vitest (`if (import.meta.vitest)`)
- TypeScript strict mode with `noUncheckedIndexedAccess`
- Tab indentation, double quotes
- Conventional Commits: `feat(core): add persona loader`

## Key Patterns

- All apps are bundled via tsdown — workspace deps go in `devDependencies`
- Persona YAML → valibot schema validation → typed Persona object
- BillingTracker records per-API-call costs tagged with personaId
- Security: RateLimiter, LoopDetector, SessionTimer, DryRunLogger
- Cognitive models: Fitts' Law, Hick's Law, Miller's Number, visual scan patterns

## Testing

Tests use vitest globals (describe, it, expect without imports).
Run `pnpm run test` from root or any package.

## Post-Change Workflow

```bash
pnpm run build
pnpm run test
pnpm typecheck
```
