import { describe, it, expect } from "vitest"
import {
	routeGeminiModel,
	detectComplexity,
	shouldRouteModel,
	getFallbackModel,
	type RoutingResult,
} from "../modelRouter"

describe("modelRouter", () => {
	describe("detectComplexity", () => {
		it("should return 50 for empty tasks", () => {
			expect(detectComplexity("")).toBe(50)
			expect(detectComplexity("   ")).toBe(50)
		})

		it("should detect simple tasks", () => {
			const simpleTasks = [
				"Fix typo in README",
				"Add simple test",
				"Format code",
				"Update comment",
				"Print hello world",
			]

			simpleTasks.forEach((task) => {
				const complexity = detectComplexity(task)
				expect(complexity).toBeLessThan(50)
			})
		})

		it("should detect complex tasks", () => {
			const complexTasks = [
				"Design a distributed transaction system for microservices",
				"Refactor the entire authentication architecture",
				"Optimize database queries for large-scale performance",
				"Debug intermittent race condition in concurrent system",
				"Analyze security vulnerabilities in the application",
			]

			complexTasks.forEach((task) => {
				const complexity = detectComplexity(task)
				expect(complexity).toBeGreaterThan(50)
			})
		})

		it("should handle task length", () => {
			const shortTask = "Fix bug"
			const mediumTask =
				"Fix authentication bug in the login handler that occurs when users attempt to login with OAuth"
			const longTask = `Design and implement a comprehensive microservices architecture
				with distributed transactions, event sourcing, CQRS patterns,
				circuit breakers, service mesh integration, monitoring, and logging.
				Ensure the system is highly available, fault-tolerant, and can scale
				horizontally across multiple regions. Include detailed error handling
				and retry logic for transient failures. The architecture should support
				both synchronous and asynchronous communication patterns.`

			expect(detectComplexity(shortTask)).toBeLessThan(detectComplexity(mediumTask))
			expect(detectComplexity(mediumTask)).toBeLessThan(detectComplexity(longTask))
		})

		it("should detect multiple files/components", () => {
			const singleFileTask = "Update index.ts"
			const multiFileTask = "Update index.ts, config.ts, utils.ts, api.ts, and handler.ts"

			const singleComplexity = detectComplexity(singleFileTask)
			const multiComplexity = detectComplexity(multiFileTask)

			expect(multiComplexity).toBeGreaterThan(singleComplexity)
		})

		it("should detect numbered lists", () => {
			const simpleTask = "Add a button"
			const listTask = `1. Add a button
2. Connect event handler
3. Test functionality
4. Update documentation`

			expect(detectComplexity(listTask)).toBeGreaterThan(detectComplexity(simpleTask))
		})

		it("should detect code blocks", () => {
			const simpleTask = "Fix the login function"
			const codeBlockTask = `Fix the login function:
\`\`\`typescript
async function login(user, password) {
  // implementation
}
\`\`\``

			expect(detectComplexity(codeBlockTask)).toBeGreaterThan(detectComplexity(simpleTask))
		})

		it("should clamp complexity to 0-100 range", () => {
			// Test with extreme inputs that might push beyond bounds
			const extremeSimple = "fix"
			const extremeComplex =
				"system architecture design algorithm refactor optimize debug analyze complex large-scale distributed microservices performance scalability security integration migration restructure overhaul redesign ".repeat(
					10,
				)

			const simpleComplexity = detectComplexity(extremeSimple)
			const complexComplexity = detectComplexity(extremeComplex)

			expect(simpleComplexity).toBeGreaterThanOrEqual(0)
			expect(simpleComplexity).toBeLessThanOrEqual(100)
			expect(complexComplexity).toBeGreaterThanOrEqual(0)
			expect(complexComplexity).toBeLessThanOrEqual(100)
		})

		it("should handle real-world examples", () => {
			const examples = [
				{ task: "Write unit tests for payment module", expectedRange: [20, 40] },
				{ task: "Implement OAuth2 authentication flow", expectedRange: [55, 75] },
				{ task: "Add console.log statement", expectedRange: [10, 30] },
				{ task: "Design scalable microservices architecture", expectedRange: [70, 95] },
			]

			examples.forEach(({ task, expectedRange }) => {
				const complexity = detectComplexity(task)
				expect(complexity).toBeGreaterThanOrEqual(expectedRange[0])
				expect(complexity).toBeLessThanOrEqual(expectedRange[1])
			})
		})
	})

	describe("routeGeminiModel", () => {
		it("should route simple tasks to flash", async () => {
			const result = await routeGeminiModel("Fix typo in README")

			expect(result.selectedModel).toBe("gemini-2.5-flash")
			expect(result.complexity).toBeLessThan(50)
			expect(result.reasoning).toContain("flash")
		})

		it("should route complex tasks to pro", async () => {
			const result = await routeGeminiModel(
				"Design a distributed transaction system for microservices with event sourcing and CQRS patterns",
			)

			expect(result.selectedModel).toBe("gemini-2.5-pro")
			expect(result.complexity).toBeGreaterThanOrEqual(50)
			expect(result.reasoning).toContain("pro")
		})

		it("should respect custom threshold", async () => {
			const task = "Refactor authentication module"

			// With low threshold, should use pro
			const lowThresholdResult = await routeGeminiModel(task, { simpleThreshold: 30 })
			expect(lowThresholdResult.selectedModel).toBe("gemini-2.5-pro")

			// With high threshold, should use flash
			const highThresholdResult = await routeGeminiModel(task, { simpleThreshold: 70 })
			expect(highThresholdResult.selectedModel).toBe("gemini-2.5-flash")
		})

		it("should default to pro when routing is disabled", async () => {
			const result = await routeGeminiModel("Simple task", { enabled: false })

			expect(result.selectedModel).toBe("gemini-2.5-pro")
			expect(result.complexity).toBe(100)
			expect(result.reasoning).toContain("disabled")
		})

		it("should include complexity in result", async () => {
			const result = await routeGeminiModel("Test task")

			expect(result).toHaveProperty("complexity")
			expect(typeof result.complexity).toBe("number")
			expect(result.complexity).toBeGreaterThanOrEqual(0)
			expect(result.complexity).toBeLessThanOrEqual(100)
		})

		it("should include reasoning in result", async () => {
			const result = await routeGeminiModel("Test task")

			expect(result).toHaveProperty("reasoning")
			expect(typeof result.reasoning).toBe("string")
			expect(result.reasoning.length).toBeGreaterThan(0)
		})

		it("should use default config values", async () => {
			const result = await routeGeminiModel("Medium complexity task")

			// Should use defaults: enabled=true, threshold=50
			expect(result.selectedModel).toMatch(/^gemini-2\.5-(flash|pro)$/)
		})
	})

	describe("shouldRouteModel", () => {
		it("should return true for gemini-2.5 models", () => {
			expect(shouldRouteModel("gemini-2.5-pro")).toBe(true)
			expect(shouldRouteModel("gemini-2.5-flash")).toBe(true)
		})

		it("should return true for gemini-2.0-flash-thinking", () => {
			expect(shouldRouteModel("gemini-2.0-flash-thinking-exp-01-21")).toBe(true)
		})

		it("should return false for non-gemini models", () => {
			expect(shouldRouteModel("claude-3-opus")).toBe(false)
			expect(shouldRouteModel("gpt-4")).toBe(false)
			expect(shouldRouteModel("gemini-1.5-pro")).toBe(false)
		})
	})

	describe("getFallbackModel", () => {
		it("should fallback to pro if flash is requested", () => {
			expect(getFallbackModel("gemini-2.5-flash")).toBe("gemini-2.5-pro")
		})

		it("should fallback to flash for any other model", () => {
			expect(getFallbackModel("gemini-2.5-pro")).toBe("gemini-2.5-flash")
			expect(getFallbackModel("gemini-2.0-flash-thinking-exp-01-21")).toBe("gemini-2.5-flash")
		})
	})

	describe("edge cases", () => {
		it("should handle very long tasks", async () => {
			const longTask = "A".repeat(10000)
			const result = await routeGeminiModel(longTask)

			expect(result.selectedModel).toMatch(/^gemini-2\.5-(flash|pro)$/)
			expect(result.complexity).toBeGreaterThanOrEqual(0)
			expect(result.complexity).toBeLessThanOrEqual(100)
		})

		it("should handle tasks with special characters", async () => {
			const specialTask = "Fix bug in @component/utils.ts -> handleError() function"
			const result = await routeGeminiModel(specialTask)

			expect(result.selectedModel).toMatch(/^gemini-2\.5-(flash|pro)$/)
		})

		it("should handle tasks with emojis", async () => {
			const emojiTask = "Add 🔥 feature to the app"
			const result = await routeGeminiModel(emojiTask)

			expect(result.selectedModel).toMatch(/^gemini-2\.5-(flash|pro)$/)
		})

		it("should handle multilingual tasks", async () => {
			const multilingualTask = "修复登录错误 (Fix login error)"
			const result = await routeGeminiModel(multilingualTask)

			expect(result.selectedModel).toMatch(/^gemini-2\.5-(flash|pro)$/)
		})
	})

	describe("consistency", () => {
		it("should produce consistent results for the same task", async () => {
			const task = "Implement user authentication"

			const result1 = await routeGeminiModel(task)
			const result2 = await routeGeminiModel(task)
			const result3 = await routeGeminiModel(task)

			expect(result1.selectedModel).toBe(result2.selectedModel)
			expect(result2.selectedModel).toBe(result3.selectedModel)
			expect(result1.complexity).toBe(result2.complexity)
			expect(result2.complexity).toBe(result3.complexity)
		})
	})
})
