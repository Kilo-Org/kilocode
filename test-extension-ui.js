const { spawn } = require("child_process")
const path = require("path")

// 测试扩展UI功能
class ExtensionTester {
	constructor() {
		this.traeProcess = null
	}

	async startTrae() {
		console.log("🚀 Starting Trae AI...")

		return new Promise((resolve, reject) => {
			// 启动Trae AI
			this.traeProcess = spawn("trae", ["src"], {
				cwd: process.cwd(),
				stdio: ["pipe", "pipe", "pipe"],
			})

			this.traeProcess.stdout.on("data", (data) => {
				console.log(`Trae stdout: ${data}`)
			})

			this.traeProcess.stderr.on("data", (data) => {
				console.log(`Trae stderr: ${data}`)
			})

			this.traeProcess.on("error", (error) => {
				console.error("Failed to start Trae:", error)
				reject(error)
			})

			// 等待Trae启动
			setTimeout(() => {
				console.log("✅ Trae should be running now")
				resolve()
			}, 3000)
		})
	}

	async testCommandAvailability() {
		console.log("\n🔍 Testing command availability...")

		// 这里我们需要手动验证，因为命令行无法直接访问VS Code的命令系统
		console.log("📋 Manual verification steps:")
		console.log("1. Open Command Palette (Cmd+Shift+P)")
		console.log('2. Type "kilo-code" to see all available commands')
		console.log('3. Look for "kilo-code.settingsButtonClicked"')
		console.log("4. Execute the command")
		console.log("5. Verify that the settings panel opens")

		return true
	}

	async testExtensionActivation() {
		console.log("\n🔧 Testing extension activation...")

		// 检查扩展是否在列表中
		const { exec } = require("child_process")

		return new Promise((resolve) => {
			exec("trae --list-extensions --show-versions", (error, stdout, stderr) => {
				if (error) {
					console.error("Error checking extensions:", error)
					resolve(false)
					return
				}

				const hasKiloCode = stdout.includes("kilo-code")
				console.log(`Extension installed: ${hasKiloCode ? "✅" : "❌"}`)

				if (hasKiloCode) {
					console.log("Found extensions:")
					const kiloExtensions = stdout.split("\n").filter((line) => line.includes("kilo-code"))
					kiloExtensions.forEach((ext) => console.log(`  - ${ext}`))
				}

				resolve(hasKiloCode)
			})
		})
	}

	async runTests() {
		console.log("🧪 Starting Extension Tests")
		console.log("============================\n")

		try {
			// 测试扩展激活
			const isActivated = await this.testExtensionActivation()
			if (!isActivated) {
				console.log("❌ Extension not properly installed")
				return false
			}

			// 启动Trae
			await this.startTrae()

			// 测试命令可用性
			await this.testCommandAvailability()

			console.log("\n✅ All automated tests completed")
			console.log("\n🎯 Next Steps:")
			console.log("1. Manually test the command in Trae AI")
			console.log("2. Check the browser console for any errors")
			console.log("3. Verify the settings panel functionality")

			return true
		} catch (error) {
			console.error("❌ Test failed:", error)
			return false
		}
	}

	cleanup() {
		if (this.traeProcess) {
			console.log("🧹 Cleaning up Trae process...")
			this.traeProcess.kill()
		}
	}
}

// 运行测试
const tester = new ExtensionTester()

tester
	.runTests()
	.then((success) => {
		console.log(`\n🏁 Tests ${success ? "completed successfully" : "failed"}`)

		// 保持进程运行一段时间以便手动测试
		console.log("\n⏰ Keeping Trae running for 30 seconds for manual testing...")
		setTimeout(() => {
			tester.cleanup()
			process.exit(success ? 0 : 1)
		}, 30000)
	})
	.catch((error) => {
		console.error("❌ Test runner failed:", error)
		tester.cleanup()
		process.exit(1)
	})

// 处理进程退出
process.on("SIGINT", () => {
	console.log("\n🛑 Received SIGINT, cleaning up...")
	tester.cleanup()
	process.exit(0)
})
