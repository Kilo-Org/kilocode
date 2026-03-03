import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
	files: "out/src/test/**/*.test.js",
	mocha: {
		timeout: 120_000,
	},
	launchArgs: [
		"--disable-gpu",
		"--disable-workspace-trust",
		// Disable all built-in extensions to speed up startup and prevent
		// the extension host from becoming unresponsive during activation.
		// The extension under development is still loaded.
		"--disable-extensions",
	],
})
