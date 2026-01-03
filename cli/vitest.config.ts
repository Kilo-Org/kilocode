import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		// Test file patterns
		include: ["src/**/*.test.ts", "src/**/*.test.tsx", "integration-tests/**/*.test.ts"],

		// Timeout for tests (integration tests may take longer)
		testTimeout: 30000,

		// Run tests sequentially to avoid conflicts with temp directories
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},

		// Global setup/teardown
		globals: true,

		// Coverage configuration
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: ["node_modules/**", "dist/**", "integration-tests/**", "**/*.test.ts", "**/*.config.*"],
		},

		// Environment
		environment: "node",

		// Reporters
		reporters: ["verbose"],
	},
})
