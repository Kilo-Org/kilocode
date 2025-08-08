import { describe, it, expect } from "vitest"
import { getModeSelection } from "../modes"
import type { PromptComponent } from "@roo-code/types"

describe("modes - simple message scenario", () => {
	// 模拟用户配置中存在空的 promptComponent 的情况
	const emptyPromptComponent: PromptComponent = {
		roleDefinition: "",
	}

	const undefinedPromptComponent: PromptComponent = {
		roleDefinition: undefined as any,
	}

	describe("getModeSelection", () => {
		it("should return architect mode roleDefinition when promptComponent has empty roleDefinition", () => {
			const result = getModeSelection("architect", emptyPromptComponent)

			expect(result).toBeDefined()
			expect(result.roleDefinition).toBeDefined()
			expect(result.roleDefinition).toContain("You are Kilo Code, an experienced technical leader")
			expect(result.description).toBeDefined()
		})

		it("should return architect mode roleDefinition when promptComponent has undefined roleDefinition", () => {
			const result = getModeSelection("architect", undefinedPromptComponent)

			expect(result).toBeDefined()
			expect(result.roleDefinition).toBeDefined()
			expect(result.roleDefinition).toContain("You are Kilo Code, an experienced technical leader")
			expect(result.description).toBeDefined()
		})

		it("should return architect mode roleDefinition when no promptComponent provided", () => {
			const result = getModeSelection("architect")

			expect(result).toBeDefined()
			expect(result.roleDefinition).toBeDefined()
			expect(result.roleDefinition).toContain("You are Kilo Code, an experienced technical leader")
			expect(result.description).toBeDefined()
		})
	})

	// 模拟实际使用场景：用户发送简单消息时的处理
	describe("real scenario simulation", () => {
		it("should handle simple user message without crashing", () => {
			// 模拟用户配置可能存在的情况
			const userMessage = "你是什么模型"

			// 测试 getModeSelection 不会因为空的 promptComponent 而崩溃
			const modeSelection1 = getModeSelection("architect", emptyPromptComponent)
			expect(modeSelection1.roleDefinition).toBeDefined()
			expect(typeof modeSelection1.roleDefinition).toBe("string")
			expect(modeSelection1.roleDefinition.length).toBeGreaterThan(0)

			// 测试 undefined promptComponent 的情况
			const modeSelection2 = getModeSelection("architect", undefinedPromptComponent)
			expect(modeSelection2.roleDefinition).toBeDefined()
			expect(typeof modeSelection2.roleDefinition).toBe("string")
			expect(modeSelection2.roleDefinition.length).toBeGreaterThan(0)

			// 测试没有 promptComponent 的情况
			const modeSelection3 = getModeSelection("architect")
			expect(modeSelection3.roleDefinition).toBeDefined()
			expect(typeof modeSelection3.roleDefinition).toBe("string")
			expect(modeSelection3.roleDefinition.length).toBeGreaterThan(0)
		})

		it("should handle different modes correctly", () => {
			// 测试其他模式也能正确处理空的 promptComponent
			const codeMode = getModeSelection("code", emptyPromptComponent)
			expect(codeMode.roleDefinition).toBeDefined()
			expect(codeMode.roleDefinition).toContain("highly skilled software engineer")

			const askMode = getModeSelection("ask", emptyPromptComponent)
			expect(askMode.roleDefinition).toBeDefined()
			expect(askMode.roleDefinition).toContain("knowledgeable technical assistant")

			const debugMode = getModeSelection("debug", emptyPromptComponent)
			expect(debugMode.roleDefinition).toBeDefined()
			expect(debugMode.roleDefinition).toContain("expert software debugger")
		})
	})
})
