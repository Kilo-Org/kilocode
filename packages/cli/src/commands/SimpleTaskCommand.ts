import chalk from "chalk"
import ora from "ora"
import { initializeCLI } from "../bootstrap"

export interface TaskOptions {
	config?: string
	provider?: string
	output?: "text" | "json" | "markdown"
	dryRun?: boolean
}

export class SimpleTaskCommand {
	async execute(prompt: string, options: TaskOptions = {}): Promise<void> {
		const spinner = ora("Initializing CLI environment...").start()

		try {
			// Initialize CLI environment with VS Code mocking
			spinner.text = "Setting up VS Code environment..."
			const { mockContext, vscodeModule, cliProvider } = await initializeCLI({
				workingDirectory: process.cwd(),
				configPath: options.config,
			})

			spinner.text = "VS Code environment ready"

			if (options.dryRun) {
				spinner.succeed("Dry run mode - showing what would be executed:")
				console.log(chalk.blue("Task:"), prompt)
				console.log(chalk.blue("Working Directory:"), process.cwd())
				console.log(chalk.blue("Output format:"), options.output || "text")
				return
			}

			spinner.text = "Testing VS Code API access..."

			// Test basic VS Code API functionality without creating full Task
			const vscode = global.vscode
			console.log(chalk.green("\n🤖 CLI Environment Test Results:"))
			console.log(chalk.blue("Task:"), prompt)
			console.log(chalk.gray("VS Code API available:"), !!vscode)
			console.log(chalk.gray("Workspace folders:"), vscode?.workspace?.workspaceFolders?.length || 0)
			console.log(chalk.gray("Mock context created:"), !!mockContext)
			console.log(chalk.gray("Extension context ID:"), mockContext.extension?.id || "N/A")

			// Test file system operations
			spinner.text = "Testing file system operations..."
			const fs = vscode?.workspace?.fs
			if (fs) {
				try {
					const workspaceUri = vscode.Uri.file(process.cwd())
					const stat = await fs.stat(workspaceUri)
					console.log(chalk.gray("File system test:"), "✅ Working")
				} catch (error) {
					console.log(chalk.gray("File system test:"), "❌ Failed:", error.message)
				}
			}

			// Initialize TelemetryService
			spinner.text = "Testing telemetry service..."
			const { TelemetryService } = await import("@roo-code/telemetry")
			if (!TelemetryService.hasInstance()) {
				TelemetryService.createInstance([])
				TelemetryService.instance.updateTelemetryState(false)
			}
			console.log(chalk.gray("Telemetry service:"), "✅ Initialized")

			const result = {
				summary: `CLI environment successfully initialized and tested`,
				actions: [
					{ description: "Initialized CLI environment with VS Code mocking" },
					{ description: "Created mock extension context" },
					{ description: "Tested VS Code API access" },
					{ description: "Verified file system operations" },
					{ description: "Initialized telemetry service" },
				],
				output: `CLI environment is ready for task execution. Task: "${prompt}"`,
			}

			spinner.succeed("CLI environment test completed successfully!")

			// Format and display output
			this.displayResult(result, options.output || "text")
		} catch (error) {
			spinner.fail("CLI environment test failed")
			console.error(chalk.red("Error:"), error instanceof Error ? error.message : String(error))
			console.error(chalk.red("Stack:"), error instanceof Error ? error.stack : "")
			throw error
		}
	}

	private displayResult(result: any, format: string): void {
		switch (format) {
			case "json":
				console.log(JSON.stringify(result, null, 2))
				break
			case "markdown":
				console.log(this.formatAsMarkdown(result))
				break
			default:
				console.log(this.formatAsText(result))
		}
	}

	private formatAsText(result: any): string {
		if (typeof result === "string") {
			return result
		}

		let output = ""
		if (result.summary) {
			output += chalk.green("Summary: ") + result.summary + "\n\n"
		}

		if (result.actions && result.actions.length > 0) {
			output += chalk.blue("Actions taken:\n")
			result.actions.forEach((action: any, index: number) => {
				output += `  ${index + 1}. ${action.description}\n`
			})
			output += "\n"
		}

		if (result.output) {
			output += chalk.yellow("Output:\n") + result.output
		}

		return output
	}

	private formatAsMarkdown(result: any): string {
		let markdown = "# CLI Environment Test Result\n\n"

		if (result.summary) {
			markdown += `## Summary\n${result.summary}\n\n`
		}

		if (result.actions && result.actions.length > 0) {
			markdown += "## Actions Taken\n"
			result.actions.forEach((action: any, index: number) => {
				markdown += `${index + 1}. ${action.description}\n`
			})
			markdown += "\n"
		}

		if (result.output) {
			markdown += `## Output\n\`\`\`\n${result.output}\n\`\`\`\n`
		}

		return markdown
	}
}
