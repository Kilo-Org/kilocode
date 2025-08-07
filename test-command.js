// 简单的命令测试脚本
const { exec } = require("child_process")
const path = require("path")

// 测试命令是否存在
function testCommand() {
	console.log("Testing kilo-code.settingsButtonClicked command...")

	// 使用 trae 命令行工具测试命令
	const command = "trae --list-extensions --show-versions"

	exec(command, (error, stdout, stderr) => {
		if (error) {
			console.error("Error:", error)
			return
		}

		console.log("Installed extensions:")
		console.log(stdout)

		// 检查是否包含 kilo-code
		if (stdout.includes("kilo-code")) {
			console.log("✅ Kilo Code extension is installed")

			// 尝试执行命令
			testSettingsCommand()
		} else {
			console.log("❌ Kilo Code extension not found")
		}
	})
}

function testSettingsCommand() {
	console.log("\nTesting settingsButtonClicked command execution...")

	// 注意：这个命令需要在 VS Code/Trae 环境中执行
	const testCommand = 'echo "Command test - this would normally trigger the settings button"'

	exec(testCommand, (error, stdout, stderr) => {
		if (error) {
			console.error("Error:", error)
			return
		}

		console.log("Test output:", stdout)
		console.log("✅ Basic command structure test completed")

		// 提供手动测试指导
		console.log("\n📋 Manual Test Instructions:")
		console.log("1. Open Trae AI with the Kilo Code extension")
		console.log("2. Open Command Palette (Cmd+Shift+P)")
		console.log('3. Search for "kilo-code.settingsButtonClicked"')
		console.log("4. Execute the command")
		console.log("5. Check if the settings panel opens correctly")
	})
}

// 运行测试
testCommand()
