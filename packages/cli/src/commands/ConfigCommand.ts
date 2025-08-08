import chalk from "chalk"
import { CLIConfig } from "../core/CLIConfig"

export class ConfigCommand {
	private config: CLIConfig

	constructor() {
		this.config = new CLIConfig()
	}

	async set(key: string, value: string): Promise<void> {
		try {
			await this.config.loadDefaults()
			this.config.set(key, value)
			await this.config.save()
			console.log(chalk.green(`✓ Set ${key} = ${value}`))
		} catch (error) {
			console.error(chalk.red(`Failed to set ${key}:`), error)
			throw error
		}
	}

	async get(key: string): Promise<void> {
		try {
			await this.config.loadDefaults()
			const value = this.config.get(key)
			if (value !== undefined) {
				console.log(chalk.blue(`${key} = ${value}`))
			} else {
				console.log(chalk.yellow(`${key} is not set`))
			}
		} catch (error) {
			console.error(chalk.red(`Failed to get ${key}:`), error)
			throw error
		}
	}

	async list(): Promise<void> {
		try {
			await this.config.loadDefaults()
			const allConfig = this.config.getAll()

			console.log(chalk.blue("Current configuration:"))
			Object.entries(allConfig).forEach(([key, value]) => {
				console.log(`  ${chalk.cyan(key)}: ${value}`)
			})
		} catch (error) {
			console.error(chalk.red("Failed to list configuration:"), error)
			throw error
		}
	}
}
