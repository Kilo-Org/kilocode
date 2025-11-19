import * as vscode from "vscode"
import { scrub, findSensitiveValues } from "@zapier/secret-scrubber"

export type LogFunction = (...args: unknown[]) => void

/**
 * Creates a logging function that writes to a VSCode output channel
 * Based on the outputChannelLog implementation from src/extension/api.ts
 */
export function createOutputChannelLogger(outputChannel: vscode.OutputChannel): LogFunction {
	return (...args: unknown[]) => {
		for (const arg of args) {
			if (arg === null) {
				outputChannel.appendLine("null")
			} else if (arg === undefined) {
				outputChannel.appendLine("undefined")
			} else if (typeof arg === "string") {
				outputChannel.appendLine(arg)
			} else if (arg instanceof Error) {
				outputChannel.appendLine(`Error: ${arg.message}\n${arg.stack || ""}`)
			} else {
				try {
					outputChannel.appendLine(
						JSON.stringify(
							arg,
							(key, value) => {
								if (typeof value === "bigint") return `BigInt(${value})`
								if (typeof value === "function") return `Function: ${value.name || "anonymous"}`
								if (typeof value === "symbol") return value.toString()
								return value
							},
							2,
						),
					)
				} catch (error) {
					outputChannel.appendLine(`[Non-serializable object: ${Object.prototype.toString.call(arg)}]`)
				}
			}
		}
	}
}

/**
 * Creates a logging function that logs to both the output channel and console
 * Following the pattern from src/extension/api.ts
 */
export function createDualLogger(outputChannelLog: LogFunction): LogFunction {
	return (...args: unknown[]) => {
		outputChannelLog(...args)
		console.log(...args)
	}
}

function makeSafe(input: any): any {
	const sensitiveValues = findSensitiveValues(input)
	// Handle case where findSensitiveValues returns empty array
	if (sensitiveValues.length === 0) {
		return input
	}
	return scrub(input, sensitiveValues)
}

export function createDualDebugLogger(outputChannelLog: LogFunction): LogFunction {
	return (...args: unknown[]) => {
		const debugMode = vscode.workspace.getConfiguration("kilo-code").get<boolean>("debugMode") ?? false
		if (debugMode) {
			// Join all arguments into a single string for output channel
			// to avoid each argument being printed on a new line
			const joinedMessage = args
				.map((arg) => {
					if (typeof arg === "string") {
						return makeSafe(arg)
					} else {
						try {
							return JSON.stringify(
								arg,
								(key, value) => {
									if (typeof value === "bigint") return `BigInt(${value})`
									if (typeof value === "function") return `Function: ${value.name || "anonymous"}`
									if (typeof value === "symbol") return value.toString()
									return makeSafe(value)
								},
								2,
							)
						} catch (error) {
							return `[Non-serializable object: ${Object.prototype.toString.call(arg)}]`
						}
					}
				})
				.join(" ")

			outputChannelLog(joinedMessage)
			console.debug(...args)
		}
		// If debugMode is false, do nothing (implicit return)
	}
}

/**
 * DebugLogger class that creates and exports a singleton logger
 * Using createDualDebugLogger() for conditional dual output to both output channel and console
 */
class DebugLogger {
	private static instance: LogFunction

	private constructor() {}

	public static getLogger(): LogFunction {
		if (!DebugLogger.instance) {
			const outputChannel = vscode.window.createOutputChannel("Kilo-Code Debug Logger")
			const outputChannelLogger = createOutputChannelLogger(outputChannel)
			DebugLogger.instance = createDualDebugLogger(outputChannelLogger)
		}
		DebugLogger.instance("DebugLogger initialized: WARNING: Sensitive information may be included in debug logs.")
		DebugLogger.instance("A basic attempt has been made to scrub sensitive information from logs.")
		DebugLogger.instance("Care should still be taken to avoid sharing logs that may contain sensitive information.")
		return DebugLogger.instance
	}
}

export const debugLogger = DebugLogger.getLogger()
