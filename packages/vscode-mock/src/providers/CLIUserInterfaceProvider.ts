import * as readline from "readline"
import chalk from "chalk"
import inquirer from "inquirer"
import { type Ora, oraPromise } from "ora"

// Local interfaces to replace the deleted @kilo-code/core imports
export interface ProgressReporter {
	report: (messageOrPercentage: string | number, message?: string) => void
	isCancelled: () => boolean
}

export interface ProgressOptions {
	cancellable?: boolean
	location?: string
}

export interface InputOptions {
	defaultValue?: string
	password?: boolean
	validate?: (input: string) => string | undefined
}

export interface SelectionOption<T = any> {
	label: string
	value: T
	description?: string
}

export interface SelectionConfig {
	canSelectMany?: boolean
	placeholder?: string
}

export interface ConfirmationOptions {
	defaultValue?: boolean
	detail?: string
}

export interface MessageOptions {
	modal?: boolean
	detail?: string
}

export interface MessageAction {
	title: string
	isCloseAffordance?: boolean
}

export interface FilePickerOptions {
	canSelectFiles?: boolean
	canSelectFolders?: boolean
	canSelectMany?: boolean
	defaultUri?: string
	openLabel?: string
	filters?: Record<string, string[]>
}

export interface FolderPickerOptions {
	canSelectMany?: boolean
	defaultUri?: string
	openLabel?: string
}

export interface SaveDialogOptions {
	defaultUri?: string
	saveLabel?: string
	filters?: Record<string, string[]>
}

export interface OutputOptions {
	preserveFocus?: boolean
	reveal?: boolean
}

export interface IUserInterface {
	showProgress<T>(
		title: string,
		task: (progress: ProgressReporter) => Promise<T>,
		options?: ProgressOptions,
	): Promise<T>
	askQuestion(prompt: string, options?: InputOptions): Promise<string | undefined>
	askSelection<T>(
		prompt: string,
		options: SelectionOption<T>[],
		config?: SelectionConfig,
	): Promise<T | T[] | undefined>
	askConfirmation(prompt: string, options?: ConfirmationOptions): Promise<boolean>
	showMessage(message: string, options?: MessageOptions, ...actions: MessageAction[]): Promise<string | undefined>
	showError(message: string, options?: MessageOptions, ...actions: MessageAction[]): Promise<string | undefined>
	showWarning(message: string, options?: MessageOptions, ...actions: MessageAction[]): Promise<string | undefined>
	showInfo(message: string, options?: MessageOptions, ...actions: MessageAction[]): Promise<string | undefined>
	pickFile(options?: FilePickerOptions): Promise<string | string[] | undefined>
	pickFolder(options?: FolderPickerOptions): Promise<string | string[] | undefined>
	saveFile(options?: SaveDialogOptions): Promise<string | undefined>
	writeOutput(message: string, options?: OutputOptions): void
	setStatus(message: string, timeout?: number): void
	clearStatus(): void
	supportsRichFormatting(): boolean
	enterInteractiveMode(): Promise<void>
	exitInteractiveMode(): void
	dispose(): void
}

/**
 * CLI implementation of the IUserInterface interface using inquirer, chalk, and ora.
 * Provides comprehensive user interaction capabilities for command-line environments.
 */
export class CLIUserInterfaceProvider implements IUserInterface {
	private isInteractiveMode: boolean
	private currentSpinner: Ora | null = null
	private statusTimeout: NodeJS.Timeout | null = null

	constructor(interactive: boolean = process.stdout.isTTY) {
		this.isInteractiveMode = interactive
	}

	async showProgress<T>(
		title: string,
		task: (progress: ProgressReporter) => Promise<T>,
		options: ProgressOptions = {},
	): Promise<T> {
		const { default: ora } = await import("ora")
		const spinner = ora(title).start()
		this.currentSpinner = spinner

		let cancelled = false
		const progressReporter: ProgressReporter = {
			report: (messageOrPercentage: string | number, message?: string) => {
				if (typeof messageOrPercentage === "string") {
					spinner.text = messageOrPercentage
				} else {
					const text = message || title
					spinner.text = `${text} (${messageOrPercentage}%)`
				}
			},
			isCancelled: () => cancelled,
		}

		// Handle cancellation if supported
		if (options.cancellable && this.isInteractiveMode) {
			const handleCancel = () => {
				cancelled = true
				spinner.fail("Operation cancelled")
			}
			process.on("SIGINT", handleCancel)
		}

		try {
			const result = await task(progressReporter)
			spinner.succeed(`${title} - Complete`)
			return result
		} catch (error) {
			spinner.fail(`${title} - Failed`)
			throw error
		} finally {
			this.currentSpinner = null
		}
	}

	async askQuestion(prompt: string, options: InputOptions = {}): Promise<string | undefined> {
		if (!this.isInteractiveMode) {
			return options.defaultValue
		}

		const answers = await inquirer.prompt([
			{
				type: options.password ? "password" : "input",
				name: "answer",
				message: prompt,
				default: options.defaultValue,
				validate: options.validate
					? (input: string) => {
							const result = options.validate!(input)
							return result === undefined ? true : result
						}
					: undefined,
			},
		])

		return answers.answer || undefined
	}

	async askSelection<T>(
		prompt: string,
		options: SelectionOption<T>[],
		config: SelectionConfig = {},
	): Promise<T | T[] | undefined> {
		if (!this.isInteractiveMode) {
			return undefined
		}

		const choices = options.map((option) => ({
			name: option.description ? `${option.label} - ${option.description}` : option.label,
			value: option.value,
		}))

		if (config.canSelectMany) {
			const answers = await inquirer.prompt([
				{
					type: "checkbox",
					name: "selection",
					message: prompt,
					choices,
				},
			])
			return answers.selection as T[]
		} else {
			const answers = await inquirer.prompt([
				{
					type: "list",
					name: "selection",
					message: prompt,
					choices,
				},
			])
			return answers.selection as T
		}
	}

	async askConfirmation(prompt: string, options: ConfirmationOptions = {}): Promise<boolean> {
		if (!this.isInteractiveMode) {
			return options.defaultValue ?? false
		}

		const answers = await inquirer.prompt([
			{
				type: "confirm",
				name: "confirmed",
				message: prompt,
				default: options.defaultValue,
			},
		])

		return answers.confirmed
	}

	async showMessage(
		message: string,
		options: MessageOptions = {},
		...actions: MessageAction[]
	): Promise<string | undefined> {
		process.stdout.write(chalk.blue("ℹ️  Info: ") + message + "\n")
		if (options.detail) {
			process.stdout.write(chalk.gray(options.detail) + "\n")
		}

		if (actions.length > 0 && this.isInteractiveMode) {
			const choices = actions.map((action) => ({
				name: action.title,
				value: action.title,
			}))

			const answers = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "Choose an action:",
					choices,
				},
			])

			return answers.action
		}

		return undefined
	}

	async showError(
		message: string,
		options: MessageOptions = {},
		...actions: MessageAction[]
	): Promise<string | undefined> {
		process.stderr.write(chalk.red("❌ Error: ") + message + "\n")
		if (options.detail) {
			process.stderr.write(chalk.gray(options.detail) + "\n")
		}

		if (actions.length > 0 && this.isInteractiveMode) {
			const choices = actions.map((action) => ({
				name: action.title,
				value: action.title,
			}))

			const answers = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "Choose an action:",
					choices,
				},
			])

			return answers.action
		}

		return undefined
	}

	async showWarning(
		message: string,
		options: MessageOptions = {},
		...actions: MessageAction[]
	): Promise<string | undefined> {
		process.stdout.write(chalk.yellow("⚠️  Warning: ") + message + "\n")
		if (options.detail) {
			process.stdout.write(chalk.gray(options.detail) + "\n")
		}

		if (actions.length > 0 && this.isInteractiveMode) {
			const choices = actions.map((action) => ({
				name: action.title,
				value: action.title,
			}))

			const answers = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "Choose an action:",
					choices,
				},
			])

			return answers.action
		}

		return undefined
	}

	async showInfo(
		message: string,
		options: MessageOptions = {},
		...actions: MessageAction[]
	): Promise<string | undefined> {
		process.stdout.write(chalk.blue("ℹ️  Info: ") + message + "\n")
		if (options.detail) {
			process.stdout.write(chalk.gray(options.detail) + "\n")
		}

		if (actions.length > 0 && this.isInteractiveMode) {
			const choices = actions.map((action) => ({
				name: action.title,
				value: action.title,
			}))

			const answers = await inquirer.prompt([
				{
					type: "list",
					name: "action",
					message: "Choose an action:",
					choices,
				},
			])

			return answers.action
		}

		return undefined
	}

	async pickFile(options: FilePickerOptions = {}): Promise<string | string[] | undefined> {
		if (!this.isInteractiveMode) {
			return undefined
		}

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "filePath",
				message: "Enter file path:",
				default: options.defaultUri,
			},
		])

		return answers.filePath
	}

	async pickFolder(options: FolderPickerOptions = {}): Promise<string | string[] | undefined> {
		if (!this.isInteractiveMode) {
			return undefined
		}

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "folderPath",
				message: "Enter folder path:",
				default: options.defaultUri,
			},
		])

		return answers.folderPath
	}

	async saveFile(options: SaveDialogOptions = {}): Promise<string | undefined> {
		if (!this.isInteractiveMode) {
			return undefined
		}

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "filePath",
				message: "Enter file path to save:",
				default: options.defaultUri,
			},
		])

		return answers.filePath
	}

	writeOutput(message: string, options: OutputOptions = {}): void {
		process.stdout.write(message)
	}

	setStatus(message: string, timeout?: number): void {
		if (this.statusTimeout) {
			clearTimeout(this.statusTimeout)
		}

		process.stdout.write(chalk.gray("Status: ") + message + "\n")

		if (timeout) {
			this.statusTimeout = setTimeout(() => {
				this.clearStatus()
			}, timeout)
		}
	}

	clearStatus(): void {
		if (this.statusTimeout) {
			clearTimeout(this.statusTimeout)
			this.statusTimeout = null
		}
	}

	supportsRichFormatting(): boolean {
		return Boolean(process.stdout.isTTY && chalk.level && chalk.level > 0)
	}

	// Additional methods expected by tests
	isInteractive(): boolean {
		return this.isInteractiveMode
	}

	setInteractive(interactive: boolean): void {
		this.isInteractiveMode = interactive
	}

	async write(message: string, options?: OutputOptions): Promise<void> {
		this.writeOutput(message, options)
	}

	async writeLine(message: string, options?: OutputOptions): Promise<void> {
		this.writeOutput(message + "\n", options)
	}

	async clear(): Promise<void> {
		if (process.stdout.isTTY) {
			console.clear()
		}
	}

	async openFilePicker(options?: FilePickerOptions): Promise<string | string[] | undefined> {
		return this.pickFile(options)
	}

	async openFolderPicker(options?: FolderPickerOptions): Promise<string | string[] | undefined> {
		return this.pickFolder(options)
	}

	async openSaveDialog(options?: SaveDialogOptions): Promise<string | undefined> {
		return this.saveFile(options)
	}

	async enterInteractiveMode(): Promise<void> {
		this.isInteractiveMode = true
		console.log(chalk.green("🔄 Entering interactive mode..."))
	}

	exitInteractiveMode(): void {
		this.isInteractiveMode = false
		console.log(chalk.yellow("🔄 Exiting interactive mode..."))
	}

	dispose(): void {
		if (this.currentSpinner) {
			this.currentSpinner.stop()
			this.currentSpinner = null
		}
		if (this.statusTimeout) {
			clearTimeout(this.statusTimeout)
			this.statusTimeout = null
		}
	}
}
