import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: {
		compilerOptions: {
			composite: false,
			incremental: false,
		},
	},
	splitting: false,
	sourcemap: true,
	clean: true,
	outDir: "dist",
})
