import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
	},
	resolve: {
		alias: {
			// Mock the vscode module with our VSCodeAPI
			vscode: path.resolve(__dirname, "src/vscode-api.ts"),
		},
	},
})
