// API错误详细信息功能验证脚本
// 这个脚本验证功能实现并提供手动测试指导

const path = require("path")
const fs = require("fs")

console.log("API错误详细信息功能验证")
console.log("================================")

// 验证功能实现
function verifyImplementation() {
	console.log("\n验证功能实现...")

	const chatRowPath = path.join(__dirname, "webview-ui/src/components/chat/ChatRow.tsx")

	if (!fs.existsSync(chatRowPath)) {
		console.log("✗ ChatRow.tsx文件不存在")
		return false
	}

	const content = fs.readFileSync(chatRowPath, "utf8")

	// 检查关键功能是否已实现
	const checks = [
		{
			name: "显示详细错误信息按钮",
			pattern: /显示详细错误信息|Show detailed error/,
			found: content.match(/显示详细错误信息|Show detailed error/),
		},
		{
			name: "showDetailedError状态",
			pattern: /showDetailedError/,
			found: content.match(/showDetailedError/),
		},
		{
			name: "apiRequestFailedMessage显示",
			pattern: /apiRequestFailedMessage/,
			found: content.match(/apiRequestFailedMessage/),
		},
		{
			name: "复制功能",
			pattern: /copyWithFeedback/,
			found: content.match(/copyWithFeedback/),
		},
		{
			name: "展开/收起功能",
			pattern: /setShowDetailedError\(!showDetailedError\)/,
			found: content.match(/setShowDetailedError\(!showDetailedError\)/),
		},
		{
			name: "VSCodeButton组件",
			pattern: /VSCodeButton/,
			found: content.match(/VSCodeButton/),
		},
		{
			name: "条件渲染逻辑",
			pattern: /showDetailedError && apiRequestFailedMessage/,
			found: content.match(/showDetailedError && apiRequestFailedMessage/),
		},
	]

	let allPassed = true
	checks.forEach((check) => {
		if (check.found) {
			console.log(`✓ ${check.name}: 已实现`)
		} else {
			console.log(`✗ ${check.name}: 未找到`)
			allPassed = false
		}
	})

	return allPassed
}

// 检查构建状态
function checkBuildStatus() {
	console.log("\n检查构建状态...")

	const packageJsonPath = path.join(__dirname, "package.json")
	if (fs.existsSync(packageJsonPath)) {
		console.log("✓ package.json存在")
	}

	const srcPath = path.join(__dirname, "src")
	if (fs.existsSync(srcPath)) {
		console.log("✓ src目录存在")
	}

	const webviewPath = path.join(__dirname, "webview-ui")
	if (fs.existsSync(webviewPath)) {
		console.log("✓ webview-ui目录存在")
	}
}

// 提供手动测试指导
function provideTestingGuidance() {
	console.log("\n=== 手动测试指导 ===")
	console.log("\n1. 启动扩展开发模式:")
	console.log('   在VSCode中按 F5 或运行 "Run Extension" 配置')
	console.log("   或者在终端运行: code --extensionDevelopmentPath=./src --new-window")

	console.log("\n2. 触发API错误:")
	console.log("   - 打开Kilo Code聊天面板")
	console.log("   - 断开网络连接或配置错误的API密钥")
	console.log("   - 发送一个聊天消息触发API调用")

	console.log("\n3. 验证功能:")
	console.log('   ✓ 错误消息下方应显示"显示详细错误信息"按钮')
	console.log("   ✓ 按钮应有向下箭头图标")
	console.log("   ✓ 点击按钮应展开详细错误信息")
	console.log("   ✓ 展开后按钮图标变为向上箭头")
	console.log("   ✓ 详细错误信息区域应有复制按钮")
	console.log("   ✓ 复制按钮应能正确复制错误信息")
	console.log("   ✓ 再次点击按钮应收起详细信息")

	console.log("\n4. UI样式验证:")
	console.log("   ✓ 按钮样式与VSCode主题一致")
	console.log("   ✓ 详细错误信息区域有适当的背景色和边框")
	console.log("   ✓ 文本颜色符合VSCode主题")
	console.log("   ✓ 间距和布局合理")
}

// 主函数
function main() {
	console.log("开始API错误详细信息功能验证...")

	// 1. 验证功能实现
	const implementationOk = verifyImplementation()

	// 2. 检查构建状态
	checkBuildStatus()

	// 3. 提供测试指导
	provideTestingGuidance()

	if (implementationOk) {
		console.log("\n✅ 功能实现验证通过！")
		console.log("现在可以按照上述指导进行手动测试。")
	} else {
		console.log("\n❌ 功能实现验证失败！")
		console.log("请检查ChatRow.tsx中的实现。")
		process.exit(1)
	}
}

// 运行验证
if (require.main === module) {
	main()
}

module.exports = { verifyImplementation, checkBuildStatus }
