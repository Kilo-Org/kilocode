#!/usr/bin/env node

/**
 * 测试脚本：验证API请求显示请求和返回信息按钮功能
 *
 * 此脚本验证以下功能：
 * 1. 显示请求信息按钮的存在和功能
 * 2. 显示返回信息按钮的存在和功能
 * 3. 请求信息的显示和复制功能
 * 4. 返回信息的显示和复制功能
 * 5. 状态管理和UI交互
 */

const fs = require("fs")
const path = require("path")

// 文件路径
const chatRowPath = path.join(__dirname, "webview-ui/src/components/chat/ChatRow.tsx")

console.log("🧪 开始验证API请求显示按钮功能...")
console.log("=".repeat(60))

// 检查文件是否存在
if (!fs.existsSync(chatRowPath)) {
	console.error("❌ ChatRow.tsx 文件不存在:", chatRowPath)
	process.exit(1)
}

// 读取文件内容
const content = fs.readFileSync(chatRowPath, "utf8")

// 验证项目列表
const checks = [
	{
		name: "显示请求信息状态变量",
		pattern: /const \[showRequestInfo, setShowRequestInfo\] = useState\(false\)/,
		description: "检查是否添加了showRequestInfo状态变量",
	},
	{
		name: "显示返回信息状态变量",
		pattern: /const \[showResponseInfo, setShowResponseInfo\] = useState\(false\)/,
		description: "检查是否添加了showResponseInfo状态变量",
	},
	{
		name: "显示请求信息按钮",
		pattern: /title="显示请求信息"[\s\S]*?codicon-arrow-up/,
		description: "检查是否添加了显示请求信息按钮",
	},
	{
		name: "显示返回信息按钮",
		pattern: /title="显示返回信息"[\s\S]*?codicon-arrow-down/,
		description: "检查是否添加了显示返回信息按钮",
	},
	{
		name: "请求信息显示区域",
		pattern: /showRequestInfo && message\.text[\s\S]*?请求信息:/,
		description: "检查是否添加了请求信息显示区域",
	},
	{
		name: "返回信息显示区域",
		pattern: /showResponseInfo &&[\s\S]*?返回信息:/,
		description: "检查是否添加了返回信息显示区域",
	},
	{
		name: "请求信息复制功能",
		pattern: /title="复制请求信息"[\s\S]*?codicon-copy/,
		description: "检查是否添加了请求信息复制按钮",
	},
	{
		name: "返回信息复制功能",
		pattern: /title="复制返回信息"[\s\S]*?codicon-copy/,
		description: "检查是否添加了返回信息复制按钮",
	},
	{
		name: "按钮点击事件处理",
		pattern: /setShowRequestInfo\(!showRequestInfo\)/,
		description: "检查请求信息按钮的点击事件处理",
	},
	{
		name: "按钮点击事件处理",
		pattern: /setShowResponseInfo\(!showResponseInfo\)/,
		description: "检查返回信息按钮的点击事件处理",
	},
	{
		name: "事件冒泡阻止",
		pattern: /e\.stopPropagation\(\)/,
		description: "检查是否阻止了事件冒泡",
	},
	{
		name: "请求数据解析",
		pattern: /safeJsonParse<any>\(message\.text\)\?\.request/,
		description: "检查是否正确解析请求数据",
	},
	{
		name: "返回数据解析",
		pattern: /apiRequestFailedMessage \|\|[\s\S]*?safeJsonParse<any>\(message\.text\)\?\.response/,
		description: "检查是否正确解析返回数据",
	},
	{
		name: "暂无返回信息提示",
		pattern: /暂无返回信息/,
		description: "检查是否添加了暂无返回信息的提示",
	},
]

// 执行验证
let passedChecks = 0
let totalChecks = checks.length

checks.forEach((check, index) => {
	const passed = check.pattern.test(content)
	const status = passed ? "✅" : "❌"
	console.log(`${index + 1}. ${status} ${check.name}`)
	console.log(`   ${check.description}`)

	if (passed) {
		passedChecks++
	} else {
		console.log(`   ⚠️  未找到匹配的代码模式`)
	}
	console.log("")
})

// 输出总结
console.log("=".repeat(60))
console.log(`📊 验证结果: ${passedChecks}/${totalChecks} 项检查通过`)

if (passedChecks === totalChecks) {
	console.log("🎉 所有功能验证通过！")
	console.log("")
	console.log("📋 手动测试指南:")
	console.log("1. 运行 pnpm build 构建项目")
	console.log("2. 在VSCode中按F5启动调试模式")
	console.log("3. 在扩展中发起一个API请求")
	console.log("4. 在API请求的标题栏右侧查看是否有两个新按钮:")
	console.log("   - 显示请求信息按钮 (向上箭头图标)")
	console.log("   - 显示返回信息按钮 (向下箭头图标)")
	console.log("5. 点击显示请求信息按钮，验证:")
	console.log("   - 是否显示请求信息内容")
	console.log("   - 是否有复制按钮")
	console.log("   - 复制功能是否正常工作")
	console.log("6. 点击显示返回信息按钮，验证:")
	console.log("   - 是否显示返回信息内容")
	console.log("   - 是否有复制按钮")
	console.log("   - 复制功能是否正常工作")
	console.log("7. 测试按钮的展开/收起功能")
	console.log("8. 验证在不同主题下的显示效果")
	console.log("")
	console.log("🔧 技术实现要点:")
	console.log("- 添加了showRequestInfo和showResponseInfo状态变量")
	console.log("- 在API请求标题栏右侧添加了两个图标按钮")
	console.log("- 实现了请求信息和返回信息的条件渲染")
	console.log("- 添加了复制功能和相应的用户反馈")
	console.log("- 使用了VSCode主题变量确保样式一致性")
	console.log("- 实现了事件冒泡阻止，避免意外触发展开/收起")
} else {
	console.log("❌ 部分功能验证失败，请检查实现。")
	process.exit(1)
}

console.log("\n🏁 验证完成！")
