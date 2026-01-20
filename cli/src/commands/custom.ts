/**
 * Custom commands - loads markdown-based commands from ~/.kilocode/commands/ and .kilocode/commands/
 */

import fs from "fs/promises"
import * as path from "path"
import matter from "gray-matter"
import * as os from "os"
import { commandRegistry } from "./core/registry.js"
import type { Command, CommandHandler } from "./core/types.js"
import { logs } from "../services/logs.js"

/**
 * Custom command definition loaded from markdown files
 */
export interface CustomCommand {
	name: string
	content: string
	filePath: string
	description?: string
	arguments?: string[]
	mode?: string
	model?: string
}

/**
 * Validates that a command name contains only alphanumeric characters and hyphens,
 * and starts with an alphanumeric character
 */
function isValidCommandName(name: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)
}

async function scanCommandDirectory(dirPath: string, commands: Map<string, CustomCommand>): Promise<void> {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue

			const commandName = entry.name.slice(0, -3)
			const filePath = path.join(dirPath, entry.name)

			// Validate command name format.
			if (!isValidCommandName(commandName)) {
				logs.warn(
					`Skipping invalid command name "${commandName}" - must start with alphanumeric and contain only alphanumeric characters and hyphens`,
					"CustomCommand",
				)
				continue
			}

			try {
				const content = await fs.readFile(filePath, "utf-8")
				const parsed = matter(content)

				const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : ""
				const mode = typeof parsed.data.mode === "string" ? parsed.data.mode.trim() : ""
				const model = typeof parsed.data.model === "string" ? parsed.data.model.trim() : ""

				// Parse arguments list
				let args: string[] | undefined
				if (Array.isArray(parsed.data.arguments)) {
					args = parsed.data.arguments
						.filter((arg) => typeof arg === "string" && arg.trim())
						.map((arg) => arg.trim())
				}

				const command: CustomCommand = {
					name: commandName,
					content: parsed.content.trim(),
					filePath,
				}

				if (description) command.description = description
				if (args && args.length > 0) command.arguments = args
				if (mode) command.mode = mode
				if (model) command.model = model

				commands.set(commandName, command)
			} catch (error) {
				logs.warn(`Failed to parse custom command file: ${filePath}`, "CustomCommand", { error })
			}
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code
		if (code !== "ENOENT") {
			logs.warn(`Failed to scan command directory: ${dirPath}`, "CustomCommand", { error })
		}
	}
}

/**
 * Substitute arguments in command content
 * Supports: $ARGUMENTS (all args), $1, $2, $3, etc. (positional args)
 */
export function substituteArguments(content: string, args: string[]): string {
	return content.replace(/\$ARGUMENTS\b/g, args.join(" ")).replace(/\$(\d+)\b(?!\.?\d)/g, (match, num): string => {
		const index = parseInt(num, 10) - 1
		return index >= 0 && index < args.length ? args[index]! : match
	})
}

function createCustomCommandHandler(customCommand: CustomCommand): CommandHandler {
	return async (context) => {
		const { args, setMode, updateProviderModel, sendWebviewMessage } = context

		if (customCommand.mode) {
			setMode(customCommand.mode)
		}

		if (customCommand.model) {
			try {
				await updateProviderModel(customCommand.model)
			} catch (error) {
				logs.warn(`Failed to switch to model ${customCommand.model}`, "CustomCommand", { error })
			}
		}

		const processedContent = substituteArguments(customCommand.content, args)

		await sendWebviewMessage({
			type: "newTask",
			text: processedContent,
		})
	}
}

function customCommandToCliCommand(customCommand: CustomCommand): Command {
	return {
		name: customCommand.name,
		aliases: [],
		description: customCommand.description || `Custom command: ${customCommand.name}`,
		usage: customCommand.arguments
			? `/${customCommand.name} ${customCommand.arguments.map((arg) => `<${arg}>`).join(" ")}`
			: `/${customCommand.name}`,
		examples: [`/${customCommand.name}`],
		category: "chat",
		handler: createCustomCommandHandler(customCommand),
		priority: 3,
		...(customCommand.arguments && {
			arguments: customCommand.arguments.map((argument) => ({
				name: argument,
				description: "",
				required: false,
			})),
		}),
	}
}

/**
 * Load custom commands from ~/.kilocode/commands/ and .kilocode/commands/
 * Priority: project > global
 */
export async function getCustomCommands(cwd: string): Promise<CustomCommand[]> {
	const commands = new Map<string, CustomCommand>()

	const globalDir = path.join(os.homedir(), ".kilocode", "commands")
	await scanCommandDirectory(globalDir, commands)

	const projectDir = path.join(cwd, ".kilocode", "commands")
	await scanCommandDirectory(projectDir, commands)

	return Array.from(commands.values())
}

/**
 * Initialize custom commands from markdown files
 * Call this after built-in commands are initialized
 */
export async function initializeCustomCommands(cwd: string): Promise<void> {
	try {
		const customCommands = await getCustomCommands(cwd)

		for (const customCommand of customCommands) {
			if (commandRegistry.get(customCommand.name)) {
				logs.warn(`Custom command "${customCommand.name}" conflicts with an existing command`, "CustomCommand")
				continue
			}
			commandRegistry.register(customCommandToCliCommand(customCommand))
		}

		if (customCommands.length > 0) {
			logs.debug(`Loaded ${customCommands.length} custom command(s)`, "CustomCommand")
		}
	} catch (error) {
		logs.warn("Failed to load custom commands", "CustomCommand", { error })
	}
}
