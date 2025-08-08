import chalk from "chalk"
import inquirer from "inquirer"
import ora, { Ora } from "ora"

export interface IUserInterfaceAdapter {
	initialize(): void
	showProgress<T>(title: string, task: () => Promise<T>): Promise<T>
	askQuestion(prompt: string, type?: "input" | "confirm" | "list", choices?: string[]): Promise<string | boolean>
	showError(message: string): void
	showWarning(message: string): void
	showInfo(message: string): void
	showSuccess(message: string): void
	updateProgress(message: string): void
}

export class UserInterfaceAdapter implements IUserInterfaceAdapter {
	private currentSpinner?: Ora

	initialize(): void {
		// Setup any UI initialization if needed
	}

	async showProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
		this.currentSpinner = ora(title).start()

		try {
			const result = await task()
			this.currentSpinner.succeed()
			return result
		} catch (error) {
			this.currentSpinner.fail()
			throw error
		} finally {
			this.currentSpinner = undefined
		}
	}

	async askQuestion(
		prompt: string,
		type: "input" | "confirm" | "list" = "input",
		choices?: string[],
	): Promise<string | boolean> {
		const questionConfig: any = {
			type,
			name: "answer",
			message: prompt,
		}

		if (type === "list") {
			if (!choices || choices.length === 0) {
				throw new Error("You must provide a `choices` parameter when using list type")
			}
			questionConfig.choices = choices
		}

		const { answer } = await inquirer.prompt([questionConfig])
		return answer
	}

	showError(message: string): void {
		console.error(chalk.red("❌ Error:"), message)
	}

	showWarning(message: string): void {
		console.warn(chalk.yellow("⚠️  Warning:"), message)
	}

	showInfo(message: string): void {
		console.info(chalk.blue("ℹ️  Info:"), message)
	}

	showSuccess(message: string): void {
		console.log(chalk.green("✅ Success:"), message)
	}

	updateProgress(message: string): void {
		if (this.currentSpinner) {
			this.currentSpinner.text = message
		}
	}

	stopProgress(success: boolean = true, message?: string): void {
		if (this.currentSpinner) {
			if (success) {
				this.currentSpinner.succeed(message)
			} else {
				this.currentSpinner.fail(message)
			}
			this.currentSpinner = undefined
		}
	}

	log(message: string, level: "info" | "warn" | "error" | "success" = "info"): void {
		switch (level) {
			case "error":
				this.showError(message)
				break
			case "warn":
				this.showWarning(message)
				break
			case "success":
				this.showSuccess(message)
				break
			default:
				this.showInfo(message)
		}
	}
}
