#!/usr/bin/env node

/**
 * Kilo Code 扩展测试脚本
 * 用于验证扩展安装和功能
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

console.log("🔍 Kilo Code 扩展测试开始...")

// 1. 检查扩展安装状态
console.log("\n📦 检查扩展安装状态:")
try {
	const extensions = execSync("trae --list-extensions --show-versions", { encoding: "utf8" })
	const kiloExtensions = extensions.split("\n").filter((line) => line.includes("kilo"))

	if (kiloExtensions.length === 0) {
		console.log("❌ 未找到 Kilo Code 扩展")
		process.exit(1)
	}

	console.log("✅ 已安装的 Kilo 扩展:")
	kiloExtensions.forEach((ext) => {
		if (ext.trim()) {
			console.log(`   - ${ext.trim()}`)
		}
	})
} catch (error) {
	console.error("❌ 检查扩展失败:", error.message)
	process.exit(1)
}

// 2. 创建测试文件以触发扩展激活
console.log("\n📝 创建测试文件以触发扩展激活:")
const testFile = path.join(__dirname, "test-activation.js")
const testContent = `// Kilo Code 扩展激活测试文件
console.log('Hello from Kilo Code test!');

// 这个文件用于触发扩展激活
function testFunction() {
    return 'Extension should be activated now';
}

testFunction();
`

try {
	fs.writeFileSync(testFile, testContent)
	console.log(`✅ 测试文件已创建: ${testFile}`)
} catch (error) {
	console.error("❌ 创建测试文件失败:", error.message)
}

// 3. 启动 Trae AI 并提供测试指导
console.log("\n🚀 启动 Trae AI 进行手动测试:")
console.log("请按照以下步骤进行测试:")
console.log("1. 在 Trae AI 中按 Cmd+Shift+P 打开命令面板")
console.log('2. 搜索 "kilo" 或 "settings" 查看可用命令')
console.log('3. 执行 "Kilo Code: Settings Button Clicked" 命令')
console.log("4. 验证设置面板是否正确打开")
console.log("5. 检查是否有重复的按钮出现")

console.log("\n📋 调试信息:")
console.log("- 如果命令未找到，请检查浏览器开发者工具的控制台")
console.log("- 查看是否有扩展激活或命令注册的错误信息")
console.log("- 确认扩展是否正确激活")

try {
	console.log("\n🎯 正在启动 Trae AI...")
	execSync("trae .", { stdio: "inherit" })
} catch (error) {
	console.log("\n⚠️  Trae AI 已关闭或出现错误")
}

// 清理测试文件
if (fs.existsSync(testFile)) {
	fs.unlinkSync(testFile)
	console.log("🧹 测试文件已清理")
}

console.log("\n✨ 测试完成!")
