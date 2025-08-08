import { describe, it, expect } from "vitest"
import { getModeSelection } from "../modes"

describe("简单消息场景演示", () => {
	it('应该正确处理用户发送简单消息"你是什么模型"的场景', () => {
		console.log('=== 模拟用户发送简单消息: "你是什么模型" ===')

		// 场景1: promptComponent为undefined (用户发送简单消息时的典型情况)
		console.log("\n场景1: promptComponent为undefined")
		const result1 = getModeSelection("architect", undefined)
		console.log("roleDefinition:", result1.roleDefinition)
		console.log("baseInstructions:", result1.baseInstructions)
		console.log("description:", result1.description)

		// 验证修复效果：应该有有效的roleDefinition
		expect(result1.roleDefinition).toBeTruthy()
		expect(result1.roleDefinition.trim().length).toBeGreaterThan(0)

		// 场景2: promptComponent存在但roleDefinition为空字符串
		console.log("\n场景2: promptComponent存在但roleDefinition为空字符串")
		const result2 = getModeSelection("architect", { roleDefinition: "" })
		console.log("roleDefinition:", result2.roleDefinition)
		console.log("baseInstructions:", result2.baseInstructions)

		// 验证修复效果：应该回退到基础模式的roleDefinition
		expect(result2.roleDefinition).toBeTruthy()
		expect(result2.roleDefinition.trim().length).toBeGreaterThan(0)

		// 场景3: promptComponent存在但roleDefinition为undefined
		console.log("\n场景3: promptComponent存在但roleDefinition为undefined")
		const result3 = getModeSelection("architect", { roleDefinition: undefined })
		console.log("roleDefinition:", result3.roleDefinition)
		console.log("baseInstructions:", result3.baseInstructions)

		// 验证修复效果：应该回退到基础模式的roleDefinition
		expect(result3.roleDefinition).toBeTruthy()
		expect(result3.roleDefinition.trim().length).toBeGreaterThan(0)

		// 验证所有场景的修复效果
		const allResults = [result1, result2, result3]
		const allHaveValidRoleDefinition = allResults.every(
			(result) => result.roleDefinition && result.roleDefinition.trim().length > 0,
		)

		console.log("\n=== 修复验证结果 ===")
		console.log("所有场景都有有效的roleDefinition:", allHaveValidRoleDefinition)
		console.log("修复状态:", allHaveValidRoleDefinition ? "✅ 成功" : "❌ 失败")

		expect(allHaveValidRoleDefinition).toBe(true)
	})

	it("应该测试不同模式下的回退逻辑", () => {
		// 测试ask模式
		const askResult = getModeSelection("ask", undefined)
		expect(askResult.roleDefinition).toBeTruthy()
		console.log("Ask模式 roleDefinition:", askResult.roleDefinition)

		// 测试code模式
		const codeResult = getModeSelection("code", undefined)
		expect(codeResult.roleDefinition).toBeTruthy()
		console.log("Code模式 roleDefinition:", codeResult.roleDefinition)

		// 测试debug模式
		const debugResult = getModeSelection("debug", undefined)
		expect(debugResult.roleDefinition).toBeTruthy()
		console.log("Debug模式 roleDefinition:", debugResult.roleDefinition)
	})
})
