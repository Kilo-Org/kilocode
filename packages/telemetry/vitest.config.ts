import { defineConfig } from "vitest/config"

const isCI = process.env.CI === "true" || process.env.CI === "1" || Boolean(process.env.CI)

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		watch: false,
		reporters: isCI ? ["verbose"] : ["default"],
	},
})
