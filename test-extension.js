const vscode = require("vscode")

// 测试扩展命令是否正确注册
async function testExtensionCommands() {
	console.log("Testing Kilo Code extension commands...")

	try {
		// 获取所有已注册的命令
		const commands = await vscode.commands.getCommands()

		// 查找 Kilo Code 相关命令
		const kiloCommands = commands.filter((cmd) => cmd.includes("kilo-code"))

		console.log("Found Kilo Code commands:")
		kiloCommands.forEach((cmd) => {
			console.log(`  - ${cmd}`)
		})

		// 测试 settingsButtonClicked 命令
		const settingsCommand = "kilo-code.settingsButtonClicked"
		if (kiloCommands.includes(settingsCommand)) {
			console.log(`✅ Command '${settingsCommand}' is registered`)

			// 尝试执行命令
			try {
				await vscode.commands.executeCommand(settingsCommand)
				console.log(`✅ Command '${settingsCommand}' executed successfully`)
			} catch (error) {
				console.log(`❌ Error executing command '${settingsCommand}':`, error.message)
			}
		} else {
			console.log(`❌ Command '${settingsCommand}' is NOT registered`)
		}
	} catch (error) {
		console.log("❌ Error testing commands:", error.message)
	}
}

// 导出测试函数
module.exports = { testExtensionCommands }
