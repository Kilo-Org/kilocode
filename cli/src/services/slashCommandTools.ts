import path from "node:path"
import type { AllowedToolRule, AllowedToolType, SlashCommandPolicy } from "../commands/core/types.js"
import type { ExtensionChatMessage } from "../types/messages.js"

interface ToolData {
	tool: string
	path?: string
	filePattern?: string
	command?: string
	args?: string
}

export interface AllowedToolsDecision {
	allowed: boolean
	reason?: string
}

const TOOL_TYPE_ALIASES: Record<string, AllowedToolType> = {
	read: "read",
	readfile: "read",
	listfiles: "read",
	listfilestoplevel: "read",
	listfilesrecursive: "read",
	searchfiles: "read",
	codebasesearch: "read",
	listcodedefinitionnames: "read",
	write: "write",
	writefile: "write",
	editedexistingfile: "write",
	applieddiff: "write",
	newfilecreated: "write",
	insertcontent: "write",
	searchandreplace: "write",
	delete: "write",
	deletefile: "write",
	generateimage: "write",
	bash: "bash",
	command: "bash",
	execute: "bash",
	browser: "browser",
	mcp: "mcp",
	mode: "mode",
	switchmode: "mode",
	subtask: "subtask",
	subtasks: "subtask",
	newtask: "subtask",
	todo: "todo",
	updatetodolist: "todo",
	slashcommand: "slashCommand",
	runslashcommand: "slashCommand",
}

const TOOL_NAME_TO_TYPE: Record<string, AllowedToolType> = {
	readfile: "read",
	listfiles: "read",
	listfilestoplevel: "read",
	listfilesrecursive: "read",
	searchfiles: "read",
	codebasesearch: "read",
	listcodedefinitionnames: "read",
	editedexistingfile: "write",
	applieddiff: "write",
	newfilecreated: "write",
	insertcontent: "write",
	searchandreplace: "write",
	deletefile: "write",
	generateimage: "write",
	browser_action: "browser",
	use_mcp_tool: "mcp",
	access_mcp_resource: "mcp",
	use_mcp_server: "mcp",
	switchmode: "mode",
	newtask: "subtask",
	updatetodolist: "todo",
	runslashcommand: "slashCommand",
}

export function parseAllowedTools(raw: unknown): AllowedToolRule[] | null {
	if (raw === undefined || raw === null) {
		return null
	}

	const entries = normalizeAllowedToolEntries(raw)
	const rules: AllowedToolRule[] = []

	for (const entry of entries) {
		const trimmed = entry.trim()
		if (!trimmed) continue

		const parsed = parseAllowedToolEntry(trimmed)
		if (!parsed) continue

		rules.push(parsed)
	}

	return rules
}

export function checkAllowedTools(
	message: ExtensionChatMessage,
	policy: SlashCommandPolicy | null | undefined,
): AllowedToolsDecision {
	if (!policy || policy.allowedTools === null) {
		return { allowed: true }
	}

	if (policy.allowedTools.length === 0) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" does not allow any tools.`,
		}
	}

	switch (message.ask) {
		case "command": {
			const commandText = extractCommandFromMessage(message)
			return checkCommandAllowed(commandText, policy)
		}
		case "tool": {
			const toolData = parseToolData(message)
			if (!toolData) {
				return {
					allowed: false,
					reason: `Slash command "/${policy.commandName}" blocked an unrecognized tool request.`,
				}
			}
			return checkToolAllowed(toolData, policy)
		}
		case "browser_action_launch":
			return checkSimpleToolType("browser", policy)
		case "use_mcp_server":
			return checkSimpleToolType("mcp", policy)
		default:
			return { allowed: true }
	}
}

function normalizeAllowedToolEntries(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw.filter((entry): entry is string => typeof entry === "string")
	}
	if (typeof raw === "string") {
		return splitCommaSeparated(raw)
	}
	return []
}

function splitCommaSeparated(value: string): string[] {
	const result: string[] = []
	let current = ""
	let depth = 0

	for (const char of value) {
		if (char === "(") depth += 1
		if (char === ")") depth = Math.max(0, depth - 1)

		if (char === "," && depth === 0) {
			if (current.trim()) {
				result.push(current.trim())
			}
			current = ""
			continue
		}

		current += char
	}

	if (current.trim()) {
		result.push(current.trim())
	}

	return result
}

function parseAllowedToolEntry(entry: string): AllowedToolRule | null {
	const match = entry.match(/^([A-Za-z][\w-]*)(?:\((.+)\))?$/)
	if (!match) {
		return null
	}

	const name = normalizeToolName(match[1] || "")
	const type = TOOL_TYPE_ALIASES[name]
	if (!type) {
		return null
	}

	const patternSource = match[2]?.trim()
	const patterns = patternSource ? splitCommaSeparated(patternSource) : undefined

	const rule: AllowedToolRule = {
		type,
		raw: entry,
	}

	if (patterns && patterns.length > 0) {
		rule.patterns = patterns
	}

	return rule
}

function parseToolData(message: ExtensionChatMessage): ToolData | null {
	if (!message.text) return null
	try {
		return JSON.parse(message.text) as ToolData
	} catch {
		return null
	}
}

function extractCommandFromMessage(message: ExtensionChatMessage): string {
	if (!message.text) return ""
	try {
		const parsed = JSON.parse(message.text) as { command?: string }
		return parsed.command || ""
	} catch {
		return message.text
	}
}

function checkCommandAllowed(commandText: string, policy: SlashCommandPolicy): AllowedToolsDecision {
	const rules = policy.allowedTools?.filter((rule) => rule.type === "bash") ?? []
	if (rules.length === 0) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" does not allow command execution.`,
		}
	}

	if (!commandText) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" blocked an empty command request.`,
		}
	}

	const allowed = rules.some((rule) => matchesCommandRule(commandText, rule))
	if (!allowed) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" does not allow command "${commandText}".`,
		}
	}

	return { allowed: true }
}

function checkToolAllowed(toolData: ToolData, policy: SlashCommandPolicy): AllowedToolsDecision {
	const toolName = normalizeToolName(toolData.tool || "")
	const toolType = TOOL_NAME_TO_TYPE[toolName]

	if (!toolType) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" does not allow tool "${toolData.tool}".`,
		}
	}

	if (toolType === "read" || toolType === "write") {
		return checkPathToolAllowed(toolType, toolData, policy)
	}

	if (toolType === "bash") {
		const commandText = toolData.command || toolData.args || ""
		return checkCommandAllowed(commandText, policy)
	}

	return checkSimpleToolType(toolType, policy, toolData.tool)
}

function checkPathToolAllowed(
	toolType: "read" | "write",
	toolData: ToolData,
	policy: SlashCommandPolicy,
): AllowedToolsDecision {
	const rules = policy.allowedTools?.filter((rule) => rule.type === toolType) ?? []
	if (rules.length === 0) {
		return {
			allowed: false,
			reason: `Slash command "/${policy.commandName}" does not allow ${toolType} operations.`,
		}
	}

	const targetPath = toolData.path || toolData.filePattern || ""
	const allowed = rules.some((rule) => matchesPathRule(targetPath, rule))

	if (!allowed) {
		return {
			allowed: false,
			reason: targetPath
				? `Slash command "/${policy.commandName}" does not allow ${toolType} on "${targetPath}".`
				: `Slash command "/${policy.commandName}" blocked a ${toolType} operation without a path.`,
		}
	}

	return { allowed: true }
}

function checkSimpleToolType(
	toolType: AllowedToolType,
	policy: SlashCommandPolicy,
	toolName?: string,
): AllowedToolsDecision {
	const rules = policy.allowedTools?.filter((rule) => rule.type === toolType) ?? []
	if (rules.length === 0) {
		return {
			allowed: false,
			reason: toolName
				? `Slash command "/${policy.commandName}" does not allow tool "${toolName}".`
				: `Slash command "/${policy.commandName}" does not allow ${toolType} operations.`,
		}
	}
	return { allowed: true }
}

function normalizeToolName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_]/g, "")
}

function matchesPathRule(targetPath: string, rule: AllowedToolRule): boolean {
	if (!rule.patterns || rule.patterns.length === 0) {
		return true
	}

	if (!targetPath) {
		return false
	}

	return rule.patterns.some((pattern) => matchesGlobPattern(pattern, targetPath))
}

function matchesCommandRule(command: string, rule: AllowedToolRule): boolean {
	if (!rule.patterns || rule.patterns.length === 0) {
		return true
	}

	return rule.patterns.some((pattern) => matchesCommandPattern(command, pattern))
}

function matchesCommandPattern(command: string, pattern: string): boolean {
	const normalizedCommand = command.trim()
	const normalizedPattern = pattern.trim()
	if (!normalizedPattern) return false

	if (normalizedPattern === "*") return true

	if (normalizedPattern.includes("*") || normalizedPattern.includes("?")) {
		const regex = globToRegex(normalizedPattern, true)
		return regex.test(normalizedCommand)
	}

	if (normalizedPattern === normalizedCommand) {
		return true
	}

	if (normalizedCommand.startsWith(normalizedPattern)) {
		const nextChar = normalizedCommand[normalizedPattern.length]
		return nextChar === undefined || nextChar === " " || nextChar === "\t"
	}

	return false
}

function matchesGlobPattern(pattern: string, targetPath: string): boolean {
	const normalizedPattern = normalizePath(pattern)
	const normalizedTarget = normalizePath(targetPath)

	const candidates = [normalizedTarget]
	if (normalizedTarget.startsWith("/")) {
		candidates.push(normalizedTarget.slice(1))
	}

	const regex = globToRegex(normalizedPattern, false)
	return candidates.some((candidate) => regex.test(candidate))
}

function normalizePath(value: string): string {
	const normalized = value.replace(/\\/g, "/")
	const trimmed = normalized.replace(/^\.\/+/, "")
	return path.posix.normalize(trimmed)
}

function globToRegex(pattern: string, allowSpaces: boolean): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
	const withGlob = escaped
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, allowSpaces ? "." : "[^/]")

	const finalPattern = `^${withGlob}${allowSpaces ? "" : "$"}`
	return new RegExp(finalPattern)
}
