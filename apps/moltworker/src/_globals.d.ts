/**
 * Ambient declaration so that `import.meta.vitest` from @clawfooding/core
 * in-source tests compiles cleanly when type-checked from this package,
 * which does not depend on vitest directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type _AnyVitestUtils = any;

interface ImportMeta {
	readonly vitest?: _AnyVitestUtils;
}
