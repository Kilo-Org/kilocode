import { defineConfig } from "vitest/config"
import path from "path"

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

		// Ensure workspace dependencies are properly resolved
		deps: {
			optimizer: {
				web: {
					// Don't try to optimize workspace packages
					exclude: ["@kilocode/agent-runtime", "@kilocode/core-schemas"],
				},
			},
		},
	},
	// Ensure workspace packages are resolved correctly
	resolve: {
		// Resolve workspace packages from their source
		conditions: ["import", "module", "default"],
		alias: {
			// Resolve agent-runtime from source during tests (avoids needing dist/ to exist)
			"@kilocode/agent-runtime": path.resolve(__dirname, "../packages/agent-runtime/src"),
		},
	},
})
