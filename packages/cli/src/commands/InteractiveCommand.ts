import chalk from "chalk"
import inquirer from "inquirer"
import { initializeCLI, setupVSCodeModuleAlias } from "../bootstrap"
import { CLIConfig } from "../core/CLIConfig"

export interface InteractiveOptions {
	config?: string
	provider?: string
}

export class InteractiveCommand {
	private isRunning: boolean = false
	private cliProvider: any
	private mockContext: any
	private config: CLIConfig

	constructor() {
		this.config = new CLIConfig()
	}

	async execute(options: InteractiveOptions): Promise<void> {
		console.log(chalk.blue("🤖 Kilo Code Interactive Mode"))
		console.log(chalk.gray('Type "exit" or "quit" to leave, "help" for commands\n'))

		try {
			// Initialize configuration
			await this.config.loadDefaults()

			// Initialize CLI environment with VS Code mocking
			console.log(chalk.yellow("Initializing CLI environment..."))
			const { mockContext, vscodeModule, cliProvider } = await initializeCLI({
				workingDirectory: process.cwd(),
				configPath: options.config,
			})

			// Set up module aliasing so src/ imports work
			setupVSCodeModuleAlias(vscodeModule)

			this.cliProvider = cliProvider
			this.mockContext = mockContext

			console.log(chalk.green("✓ CLI environment initialized"))
			console.log(chalk.yellow("Note: This is a proof-of-concept implementation"))
			console.log()

			this.isRunning = true
			await this.startInteractiveLoop()
		} catch (error) {
			console.error(chalk.red("Failed to start interactive mode:"), error)
			throw error
		}
	}

	private async startInteractiveLoop(): Promise<void> {
		while (this.isRunning) {
			try {
				const { input } = await inquirer.prompt([
					{
						type: "input",
						name: "input",
						message: chalk.cyan("You:"),
						validate: (input: string) => input.trim().length > 0 || "Please enter a message",
					},
				])

				const trimmedInput = input.trim()

				// Handle special commands
				if (this.handleSpecialCommands(trimmedInput)) {
					continue
				}

				// Process user input with agent (mock implementation for now)
				console.log(chalk.yellow("🤖 Agent is thinking..."))

				// Simulate processing time
				await new Promise((resolve) => setTimeout(resolve, 1000))

				// Mock response for proof of concept
				const response = `I received your message: "${trimmedInput}". This is a proof-of-concept CLI implementation. Full integration with existing src/ code is in progress.`

				console.log(chalk.green("Agent:"), response)
				console.log()
			} catch (error) {
				console.error(chalk.red("Error processing message:"), error)
				console.log()
			}
		}
	}

	private handleSpecialCommands(input: string): boolean {
		const lowerInput = input.toLowerCase()

		switch (lowerInput) {
			case "exit":
			case "quit":
				console.log(chalk.blue("👋 Goodbye!"))
				this.isRunning = false
				return true

			case "help":
				this.showHelp()
				return true

			case "status":
				this.showStatus()
				return true

			case "clear":
				console.clear()
				console.log(chalk.blue("🤖 Kilo Code Interactive Mode"))
				console.log(chalk.gray('Type "exit" or "quit" to leave, "help" for commands\n'))
				return true

			default:
				return false
		}
	}

	private showHelp(): void {
		console.log(chalk.blue("\n📖 Available commands:"))
		console.log("  help     - Show this help message")
		console.log("  status   - Show current agent status")
		console.log("  clear    - Clear the screen")
		console.log("  exit     - Exit interactive mode")
		console.log("  quit     - Exit interactive mode")
		console.log("\nOr just type any message to chat with the agent!\n")
	}

	private showStatus(): void {
		console.log(chalk.blue("\n📊 Agent Status:"))
		console.log(`  Provider: ${this.config.get("provider")}`)
		console.log(`  Model: ${this.config.get("model") || "default"}`)
		console.log(`  Running: ${this.isRunning ? "✅" : "❌"}`)
		console.log()
	}
}
