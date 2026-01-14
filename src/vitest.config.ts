import { defineConfig } from "vitest/config"
import path from "path"
import { resolveVerbosity } from "./utils/vitest-verbosity"

const { silent, reporters, onConsoleLog } = resolveVerbosity()

export default defineConfig({
	test: {
		globals: true,
		setupFiles: ["./src/vitest.setup.ts", "./src/services/continuedev/core/test/vitest.setup.ts"],
		globalSetup: "./src/services/continuedev/core/test/vitest.global-setup.ts",
		watch: false,
		reporters,
		silent,
		testTimeout: 20_000,
		hookTimeout: 20_000,
		onConsoleLog,
		include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
		root: path.resolve(__dirname, ".."),
	},
	resolve: {
		alias: {
			vscode: path.resolve(__dirname, "./__mocks__/vscode.js"),
			"@": path.resolve(__dirname, "."),
		},
	},
})
