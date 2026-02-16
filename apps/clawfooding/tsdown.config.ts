import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["./src/*.ts", "!./src/**/*.test.ts", "!./src/_*.ts"],
	outDir: "dist",
	format: "esm",
	clean: true,
	minify: "dce-only",
	treeshake: true,
	dts: {
		tsgo: false,
		resolve: ["@clawfooding/core", "@clawfooding/terminal"],
	},
	define: {
		"import.meta.vitest": "undefined",
	},
});
