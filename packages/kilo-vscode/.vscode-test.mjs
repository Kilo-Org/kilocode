import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
	files: "out/src/test/**/*.test.js",
	mocha: {
		timeout: 120_000,
	},
	launchArgs: [
		"--disable-gpu",
		"--disable-workspace-trust",
		// Prevent VS Code from marking the extension host as unresponsive
		// during heavy initialization (WASM loading, etc.)
		"--extensions-unresponsive-timeout", "300000",
	],
})
