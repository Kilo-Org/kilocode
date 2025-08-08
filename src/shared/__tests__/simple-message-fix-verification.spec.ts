import { describe, it, expect } from "vitest"
import { getModeSelection } from "../modes"

describe('简单消息"你是什么模型"修复验证', () => {
	it("应该展示修复前后的对比效果", () => {
		console.log('\n=== 验证"你是什么模型"简单消息修复效果 ===\n')

		// 场景1: promptComponent为undefined (用户发送简单消息时的典型情况)
		console.log("🔍 场景1: promptComponent为undefined (用户发送简单消息)")
		const result1 = getModeSelection("architect", undefined)
		console.log("✅ roleDefinition:", result1.roleDefinition)
		console.log("✅ baseInstructions:", result1.baseInstructions)
		console.log("✅ description:", result1.description)
		console.log("")

		// 验证修复效果：应该有有效的roleDefinition
		expect(result1.roleDefinition).toBeTruthy()
		expect(result1.roleDefinition.trim().length).toBeGreaterThan(0)

		// 场景2: promptComponent存在但roleDefinition为空字符串
		console.log("🔍 场景2: promptComponent存在但roleDefinition为空字符串")
		const result2 = getModeSelection("architect", { roleDefinition: "" })
		console.log("✅ roleDefinition:", result2.roleDefinition)
		console.log("✅ baseInstructions:", result2.baseInstructions)
		console.log("")

		// 验证修复效果：应该回退到基础模式的roleDefinition
		expect(result2.roleDefinition).toBeTruthy()
		expect(result2.roleDefinition.trim().length).toBeGreaterThan(0)

		// 场景3: promptComponent存在但roleDefinition为undefined
		console.log("🔍 场景3: promptComponent存在但roleDefinition为undefined")
		const result3 = getModeSelection("architect", { roleDefinition: undefined })
		console.log("✅ roleDefinition:", result3.roleDefinition)
		console.log("✅ baseInstructions:", result3.baseInstructions)
		console.log("")

		// 验证修复效果：应该回退到基础模式的roleDefinition
		expect(result3.roleDefinition).toBeTruthy()
		expect(result3.roleDefinition.trim().length).toBeGreaterThan(0)

		// 验证所有场景的修复效果
		const allResults = [result1, result2, result3]
		const allHaveValidRoleDefinition = allResults.every(
			(result) => result.roleDefinition && result.roleDefinition.trim().length > 0,
		)

		console.log("=== 🎯 修复验证结果 ===")
		console.log("所有场景都有有效的roleDefinition:", allHaveValidRoleDefinition)
		console.log("修复状态:", allHaveValidRoleDefinition ? "✅ 成功" : "❌ 失败")
		console.log("")

		expect(allHaveValidRoleDefinition).toBe(true)

		// 测试不同模式下的回退逻辑
		console.log("=== 🔄 不同模式测试 ===")
		const modes = ["ask", "code", "debug", "architect"]
		modes.forEach((mode) => {
			const result = getModeSelection(mode, undefined)
			console.log(`${mode}模式 roleDefinition:`, result.roleDefinition)
			expect(result.roleDefinition).toBeTruthy()
		})

		console.log(
			'\n🎉 修复验证完成！用户发送"你是什么模型"这样的简单消息时，系统会正确回退到基础模式的roleDefinition。',
		)
		console.log("\n📋 修复说明:")
		console.log("- 当promptComponent为undefined时，直接使用基础模式的roleDefinition")
		console.log("- 当promptComponent.roleDefinition为空字符串或undefined时，回退到基础模式的roleDefinition")
		console.log('- 确保所有场景下都有有效的角色定义，避免AI回复中出现"Cannot read properties of undefined"错误')
	})
})
