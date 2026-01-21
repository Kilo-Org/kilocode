import { basename, extname, join } from "node:path"
import { promises as fs } from "node:fs"
import { existsSync } from "node:fs"
import fg from "fast-glob"
import matter from "gray-matter"
import { commandRegistry } from "../commands/core/registry.js"
import type {
	Command,
	CommandContext,
	CustomCommandMetadata,
	CustomCommandScope,
	SlashCommandPolicy,
} from "../commands/core/types.js"
import { KiloCodePaths } from "../utils/paths.js"
import { logs } from "./logs.js"
import { parseAllowedTools } from "./slashCommandTools.js"
import { expandSlashCommandTemplate } from "./slashCommandTemplate.js"
import { processMessageImages } from "../media/processMessageImages.js"
import { getCurrentModelId } from "../constants/providers/models.js"

export interface CustomSlashCommandDefinition {
	name: string
	description: string
	body: string
	metadata: CustomCommandMetadata
}

const PROJECT_COMMANDS_DIRNAME = ".kilocode/commands"
const COMMAND_GLOB = "**/*.md"

let cachedCustomCommands: CustomSlashCommandDefinition[] = []
let registeredCustomCommandNames: string[] = []

export function getCustomSlashCommands(): CustomSlashCommandDefinition[] {
	return cachedCustomCommands
}

export async function registerCustomSlashCommands(
	workspacePath: string | null,
): Promise<CustomSlashCommandDefinition[]> {
	unregisterCustomSlashCommands()

	const definitions = await loadCustomSlashCommands(workspacePath)
	cachedCustomCommands = definitions

	for (const definition of definitions) {
		const existing = commandRegistry.get(definition.name)
		if (existing && !existing.custom) {
			logs.warn(
				`Skipping custom command "/${definition.name}" because it conflicts with a built-in command`,
				"SlashCommands",
			)
			continue
		}

		const usageSuffix = definition.metadata.argumentHint ? ` ${definition.metadata.argumentHint}` : ""
		const command: Command = {
			name: definition.name,
			aliases: [],
			description: definition.description,
			usage: `/${definition.name}${usageSuffix}`,
			examples: [`/${definition.name}${usageSuffix}`],
			category: "chat",
			priority: 4,
			custom: definition.metadata,
			handler: async (context) => {
				await executeCustomSlashCommand(definition, context)
			},
		}

		commandRegistry.register(command)
		registeredCustomCommandNames.push(command.name)
	}

	return definitions
}

export function unregisterCustomSlashCommands(): void {
	for (const name of registeredCustomCommandNames) {
		commandRegistry.unregister(name)
	}
	registeredCustomCommandNames = []
}

export async function loadCustomSlashCommands(workspacePath: string | null): Promise<CustomSlashCommandDefinition[]> {
	const userDir = KiloCodePaths.getUserCommandsDir()
	const legacyUserDir = KiloCodePaths.getLegacyUserCommandsDir()
	const projectDir = workspacePath ? join(workspacePath, PROJECT_COMMANDS_DIRNAME) : null

	const legacyUserCommands = await loadCommandsFromDir(legacyUserDir, "user")
	const userCommands = await loadCommandsFromDir(userDir, "user")
	const projectCommands = projectDir ? await loadCommandsFromDir(projectDir, "project") : []

	const merged = new Map<string, CustomSlashCommandDefinition>()
	for (const command of legacyUserCommands) {
		merged.set(command.name, command)
	}
	for (const command of userCommands) {
		merged.set(command.name, command)
	}
	for (const command of projectCommands) {
		merged.set(command.name, command)
	}

	return Array.from(merged.values())
}

async function loadCommandsFromDir(
	directory: string,
	scope: CustomCommandScope,
): Promise<CustomSlashCommandDefinition[]> {
	if (!existsSync(directory)) {
		return []
	}

	const files = await fg(COMMAND_GLOB, {
		cwd: directory,
		onlyFiles: true,
		absolute: true,
		dot: true,
		unique: true,
	})

	const definitions: CustomSlashCommandDefinition[] = []
	const seenNames = new Set<string>()

	for (const filePath of files) {
		const definition = await loadCommandFromFile(filePath, scope)
		if (!definition) {
			continue
		}

		if (seenNames.has(definition.name)) {
			logs.warn(
				`Duplicate custom command "${definition.name}" found in ${directory}. Using last occurrence.`,
				"SlashCommands",
			)
		}

		seenNames.add(definition.name)
		definitions.push(definition)
	}

	return definitions
}

async function loadCommandFromFile(
	filePath: string,
	scope: CustomCommandScope,
): Promise<CustomSlashCommandDefinition | null> {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		const parsed = matter(raw)
		const body = parsed.content.trim()

		if (!body) {
			logs.warn(`Custom command file "${filePath}" is empty`, "SlashCommands")
			return null
		}

		const name = normalizeCommandName(basename(filePath, extname(filePath)))
		if (!name || /\s/.test(name)) {
			logs.warn(`Custom command file "${filePath}" has invalid name`, "SlashCommands")
			return null
		}

		const description = parseDescription(parsed.data, body, scope)
		const argumentHint = parseStringValue(parsed.data, ["argument-hint", "argumentHint"])
		const allowedTools = parseAllowedTools(parsed.data["allowed-tools"] ?? parsed.data.allowedTools)
		const model = parseStringValue(parsed.data, ["model"])
		const disableModelInvocation = parseBooleanValue(parsed.data, [
			"disable-model-invocation",
			"disableModelInvocation",
		])

		const metadata: CustomCommandMetadata = {
			scope,
			sourcePath: filePath,
			allowedTools,
		}

		if (argumentHint !== undefined) {
			metadata.argumentHint = argumentHint
		}

		if (model !== undefined) {
			metadata.model = model
		}

		if (disableModelInvocation !== undefined) {
			metadata.disableModelInvocation = disableModelInvocation
		}

		return {
			name,
			description,
			body,
			metadata,
		}
	} catch (error) {
		logs.error(`Failed to load custom command "${filePath}"`, "SlashCommands", { error })
		return null
	}
}

export async function executeCustomSlashCommand(
	definition: CustomSlashCommandDefinition,
	context: CommandContext,
): Promise<void> {
	const { args, addMessage, sendWebviewMessage, chatMessages } = context

	const expanded = expandSlashCommandTemplate(definition.body, args)

	const processed = await processMessageImages(expanded)

	if (processed.errors.length > 0) {
		for (const error of processed.errors) {
			addMessage({
				id: `slash-cmd-img-error-${Date.now()}-${Math.random()}`,
				type: "error",
				content: error,
				ts: Date.now(),
			})
		}
	}

	const policy: SlashCommandPolicy = {
		commandName: definition.name,
		scope: definition.metadata.scope,
		sourcePath: definition.metadata.sourcePath,
		allowedTools: definition.metadata.allowedTools ?? null,
	}

	if (definition.metadata.model !== undefined) {
		policy.model = definition.metadata.model
	}

	if (definition.metadata.disableModelInvocation !== undefined) {
		policy.disableModelInvocation = definition.metadata.disableModelInvocation
	}

	context.setSlashCommandPolicy(policy)

	await applyModelOverride(definition, context)

	const payload = {
		text: processed.text,
		...(processed.hasImages && { images: processed.images }),
	}

	try {
		if (chatMessages.length > 0) {
			await sendWebviewMessage({
				type: "askResponse",
				askResponse: "messageResponse",
				...payload,
			})
		} else {
			await sendWebviewMessage({
				type: "newTask",
				...payload,
			})
		}
	} catch (error) {
		addMessage({
			id: `slash-cmd-send-error-${Date.now()}`,
			type: "error",
			content: `Failed to run /${definition.name}: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
		context.clearSlashCommandPolicy()
		context.setPendingModelOverride(null)
	}
}

async function applyModelOverride(definition: CustomSlashCommandDefinition, context: CommandContext): Promise<void> {
	const modelOverride = definition.metadata.model
	if (!modelOverride) return

	const { currentProvider, routerModels, kilocodeDefaultModel, updateProviderModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: `slash-cmd-model-error-${Date.now()}`,
			type: "error",
			content: `Cannot apply model override for /${definition.name}: no provider configured.`,
			ts: Date.now(),
		})
		return
	}

	const currentModelId = getCurrentModelId({
		providerConfig: currentProvider,
		routerModels,
		kilocodeDefaultModel,
	})

	if (currentModelId === modelOverride) {
		return
	}

	try {
		context.setPendingModelOverride({
			commandName: definition.name,
			providerId: currentProvider.id,
			providerName: currentProvider.provider,
			previousModelId: currentModelId,
			overrideModelId: modelOverride,
		})
		await updateProviderModel(modelOverride)
	} catch (error) {
		context.setPendingModelOverride(null)
		addMessage({
			id: `slash-cmd-model-error-${Date.now()}`,
			type: "error",
			content: `Failed to switch model to "${modelOverride}" for /${definition.name}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			ts: Date.now(),
		})
	}
}

function normalizeCommandName(name: string): string {
	return name.trim().toLowerCase()
}

function parseDescription(data: Record<string, unknown>, body: string, scope: CustomCommandScope): string {
	const description = parseStringValue(data, ["description"])
	if (description) {
		return description
	}

	const fallback = extractFirstLine(body)
	if (fallback) {
		return fallback
	}

	return scope === "project" ? "Project custom command" : "User custom command"
}

function parseStringValue(data: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = data[key]
		if (typeof value === "string" && value.trim()) {
			return value.trim()
		}
	}
	return undefined
}

function parseBooleanValue(data: Record<string, unknown>, keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = data[key]
		if (typeof value === "boolean") {
			return value
		}
	}
	return undefined
}

function extractFirstLine(body: string): string | undefined {
	const lines = body.split("\n")
	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed) {
			return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
		}
	}
	return undefined
}
