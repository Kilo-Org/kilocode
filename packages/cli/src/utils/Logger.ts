import chalk from "chalk"

export enum LogLevel {
	SILENT = 0,
	ERROR = 1,
	WARN = 2,
	INFO = 3,
	DEBUG = 4,
	VERBOSE = 5,
}

export class Logger {
	private static instance: Logger
	private logLevel: LogLevel = LogLevel.ERROR // Default to quiet mode (errors only)

	private constructor() {}

	static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger()
		}
		return Logger.instance
	}

	setLogLevel(level: LogLevel): void {
		this.logLevel = level

		// Set environment variable for VS Code mock logging
		if (level >= LogLevel.VERBOSE) {
			process.env.KILO_CLI_VERBOSE = "true"
		} else {
			process.env.KILO_CLI_VERBOSE = "false"
		}
	}

	getLogLevel(): LogLevel {
		return this.logLevel
	}

	// Essential output that should always be shown (banner, results, errors)
	essential(message: string, ...args: any[]): void {
		console.log(message, ...args)
	}

	// Error messages - always shown unless SILENT
	error(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.ERROR) {
			console.error(chalk.red("❌"), message, ...args)
		}
	}

	// Warning messages
	warn(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.WARN) {
			console.warn(chalk.yellow("⚠️ "), message, ...args)
		}
	}

	// General information - shown by default
	info(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.INFO) {
			console.log(chalk.blue("ℹ️ "), message, ...args)
		}
	}

	// Success messages
	success(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.INFO) {
			console.log(chalk.green("✅"), message, ...args)
		}
	}

	// Debug information - only shown in debug mode
	debug(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.DEBUG) {
			console.log(chalk.gray("[DEBUG]"), message, ...args)
		}
	}

	// Verbose debugging - only shown in verbose mode
	verbose(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.VERBOSE) {
			console.log(chalk.dim("[VERBOSE]"), message, ...args)
		}
	}

	// Task progress - shown by default
	task(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.INFO) {
			console.log(chalk.cyan("🤖"), message, ...args)
		}
	}

	// Tool usage - shown in debug mode
	tool(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.DEBUG) {
			console.log(chalk.magenta("🛠️ "), message, ...args)
		}
	}

	// API calls - shown in verbose mode
	api(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.VERBOSE) {
			console.log(chalk.blue("[API]"), message, ...args)
		}
	}

	// File operations - shown in debug mode
	file(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.DEBUG) {
			console.log(chalk.green("📁"), message, ...args)
		}
	}

	// Configuration - shown in debug mode
	config(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.DEBUG) {
			console.log(chalk.yellow("[CONFIG]"), message, ...args)
		}
	}

	// VS Code mock operations - shown in verbose mode
	mock(message: string, ...args: any[]): void {
		if (this.logLevel >= LogLevel.VERBOSE) {
			console.log(chalk.dim("[MOCK]"), message, ...args)
		}
	}
}

// Export singleton instance
export const logger = Logger.getInstance()

// Utility function to set log level from command line options
export function setLogLevelFromOptions(options: {
	verbose?: boolean
	debug?: boolean
	quiet?: boolean
	info?: boolean
}): void {
	if (options.verbose) {
		logger.setLogLevel(LogLevel.VERBOSE)
	} else if (options.debug) {
		logger.setLogLevel(LogLevel.DEBUG)
	} else if (options.info) {
		logger.setLogLevel(LogLevel.INFO)
	} else if (options.quiet) {
		logger.setLogLevel(LogLevel.ERROR)
	} else {
		// Default is quiet mode (errors only)
		logger.setLogLevel(LogLevel.ERROR)
	}
}
