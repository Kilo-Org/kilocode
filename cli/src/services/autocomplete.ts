/**
 * Unified Autocomplete Engine
 * Provides command and argument suggestions based on user input
 */

import { commandRegistry } from "../commands/core/registry.js"
import { extractCommandName, parseCommand } from "../commands/core/parser.js"
import { fileSearchService } from "./fileSearch.js"
import type {
	Command,
	ArgumentSuggestion,
	ArgumentProviderContext,
	ArgumentDefinition,
	InputState,
	ArgumentProvider,
	ArgumentProviderCommandContext,
} from "../commands/core/types.js"

// ============================================================================
// TYPE DEFINITIONS & EXPORTS
// ============================================================================

export interface CommandSuggestion {
	command: Command
	matchScore: number
	highlightedName: string
}

export type { ArgumentSuggestion }

/**
 * File mention suggestion interface
 */
export interface FileMentionSuggestion {
	/** Relative path from workspace root */
	value: string
	/** Additional description or full path */
	description?: string
	/** Match score for sorting */
	matchScore: number
	/** Highlighted value for display */
	highlightedValue: string
	/** Type of file entry */
	type: "file" | "folder"
	/** Loading state */
	loading?: boolean
	/** Error message if any */
	error?: string
}

/**
 * File mention context detected in text
 */
export interface FileMentionContext {
	/** Whether cursor is in a file mention */
	isInMention: boolean
	/** Start position of the @ symbol */
	mentionStart: number
	/** Query string after @ */
	query: string
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

interface CacheEntry {
	key: string
	results: ArgumentSuggestion[]
	ts: number
	ttl: number
}

class ArgumentSuggestionCache {
	private cache = new Map<string, CacheEntry>()

	get(key: string): ArgumentSuggestion[] | null {
		const entry = this.cache.get(key)
		if (!entry) return null

		if (Date.now() - entry.ts > entry.ttl) {
			this.cache.delete(key)
			return null
		}

		return entry.results
	}

	set(key: string, results: ArgumentSuggestion[], ttl: number): void {
		this.cache.set(key, {
			key,
			results,
			ts: Date.now(),
			ttl,
		})
	}

	clear(): void {
		this.cache.clear()
	}
}

const cache = new ArgumentSuggestionCache()

import Fuse from "fuse.js"
import chalk from "chalk"

// ============================================================================
// SHARED UTILITIES - Scoring & Matching
// ============================================================================

/**
 * Fuse.js options for command/argument fuzzy matching
 */
const FUSE_OPTIONS = {
	includeScore: true,
	includeMatches: true,
	threshold: 0.4,
	minMatchCharLength: 2,
	ignoreLocation: true,
	keys: ["name", "description", "aliases", "value"], // Common keys
}

/**
 * Singleton Fuse instances to avoid re-indexing
 */
let fuseCommands: Fuse<Command> | null = null
let fuseArguments: Fuse<ArgumentSuggestion> | null = null

// Cache keys for the current usage of the singletons
let lastCommandList: Command[] = []

/**
 * Get or create Fuse instance for commands
 */
function getCommandFuse(commands: Command[]): Fuse<Command> {
	if (!fuseCommands || commands !== lastCommandList) {
		fuseCommands = new Fuse(commands, {
			...FUSE_OPTIONS,
			keys: ["name", "description", "aliases"],
		})
		lastCommandList = commands
	}
	return fuseCommands
}

/**
 * Calculate match score using Fuse.js
 * Returns 0-100 (higher is better)
 */
function calculateMatchScore(
	text: string,
	query: string,
	context?: { isCommand?: boolean; description?: string },
): number {
	if (!query) return context?.isCommand ? 50 : 100

	// We don't use this single-item check for Fuse usually, 
	// but for compatibility with existing architecture if called individually:
	// (This function is mainly used by filterAndScore for arguments)

	// Fallback/Fast check for exact match
	if (text.toLowerCase() === query.toLowerCase()) return 100
	if (text.toLowerCase().startsWith(query.toLowerCase())) return 90

	return 0 // Fuse is handled in bulk usually, but if individual:
}

/**
 * Highlight matching parts of text using ANSI codes
 */
function highlightMatch(text: string, indices?: readonly [number, number][]): string {
	if (!indices || indices.length === 0) return text

	let result = ""
	let lastIndex = 0

	// Sort indices by start to be sure
	const sortedIndices = [...indices].sort((a, b) => a[0] - b[0])

	for (const [start, end] of sortedIndices) {
		// Append non-matched part
		result += text.substring(lastIndex, start)
		// Append matched part with color (using cyan as generic highlight)
		// Note: We use raw console codes or a library if available. 
		// The file imports: currently nothing for color.
		// We should validly import chalk or use CLI theme if passed.
		// Since we don't have access to 'theme' here easily without context, 
		// we'll use a safe basic color or rely on the UI to colorize validation.
		// BUT the requirement was "ANSI-safe highlighting".
		// Let's use standard ANSI cyan: \u001b[36m ... \u001b[39m
		result += `\u001b[36m${text.substring(start, end + 1)}\u001b[39m`
		lastIndex = end + 1
	}

	result += text.substring(lastIndex)
	return result
}

// ============================================================================
// COMMAND SUGGESTIONS
// ============================================================================

/**
 * Get command suggestions based on input
 */
export function getSuggestions(input: string): CommandSuggestion[] {
	// Remove leading slash
	const query = input.startsWith("/") ? input.slice(1) : input

	// Get all commands
	const commands = commandRegistry.getAll()

	// If no query, return all with default score
	if (!query) {
		return commands.map(command => ({
			command,
			matchScore: 50,
			highlightedName: command.name
		})).sort((a, b) => a.command.name.localeCompare(b.command.name))
	}

	// Use Fuse for matching
	const fuse = getCommandFuse(commands)
	const fuseResults = fuse.search(query)

	// Map Fuse results to suggestions
	const suggestions: CommandSuggestion[] = fuseResults.map(result => ({
		command: result.item,
		// Fuse score is 0 (perfect) to 1 (mismatch). We invert to 0-100.
		matchScore: result.score !== undefined ? (1 - result.score) * 100 : 0,
		highlightedName: highlightMatch(result.item.name, result.matches?.find(m => m.key === "name")?.indices)
	}))

	// Fallback Logic: If no Fuse matches, check for prefix matches (legacy behavior)
	// This ensures backward compatibility for habits like "in" -> "init"
	if (suggestions.length === 0) {
		const lowerQuery = query.toLowerCase()
		for (const command of commands) {
			if (command.name.toLowerCase().startsWith(lowerQuery)) {
				suggestions.push({
					command,
					matchScore: 90, // High score for prefix
					highlightedName: command.name // No highlight (or simple prefix highlight?)
				})
			} else {
				// Check aliases
				if (command.aliases.some(a => a.toLowerCase().startsWith(lowerQuery))) {
					suggestions.push({
						command,
						matchScore: 85,
						highlightedName: command.name
					})
				}
			}
		}
	}

	// Sort by match score (descending), then by priority (descending), then alphabetically
	suggestions.sort((a, b) => {
		// Primary: Sort by match score (descending)
		if (Math.abs(b.matchScore - a.matchScore) > 1) { // Fuzzy epsilon
			return b.matchScore - a.matchScore
		}

		// Secondary: Sort by priority (descending) - default to 5 if not specified
		const priorityA = a.command.priority ?? 5
		const priorityB = b.command.priority ?? 5
		if (priorityB !== priorityA) {
			return priorityB - priorityA
		}

		// Tertiary: Sort alphabetically by name (ascending)
		return a.command.name.localeCompare(b.command.name)
	})

	return suggestions
}

/**
 * Get the best matching command for a query
 */
export function getBestMatch(input: string): Command | null {
	const suggestions = getSuggestions(input)
	const firstSuggestion = suggestions[0]
	return firstSuggestion ? firstSuggestion.command : null
}

/**
 * Check if input looks like a command
 */
export function isCommandInput(input: string): boolean {
	return input.trim().startsWith("/")
}

/**
 * Get command name from input
 */
export function getCommandFromInput(input: string): string | null {
	return extractCommandName(input)
}

// ============================================================================
// INPUT STATE DETECTION
// ============================================================================

/**
 * Check if argument dependencies are satisfied
 */
function checkDependencies(
	argumentDef: ArgumentDefinition,
	currentArgs: string[],
	command: Command,
): { satisfied: boolean; missing: string[] } {
	if (!argumentDef.dependsOn || argumentDef.dependsOn.length === 0) {
		return { satisfied: true, missing: [] }
	}

	const missing: string[] = []

	for (const dep of argumentDef.dependsOn) {
		const depIndex = command.arguments?.findIndex((a) => a.name === dep.argumentName) ?? -1

		if (depIndex === -1 || !currentArgs[depIndex]) {
			missing.push(dep.argumentName)
			continue
		}

		const depValue = currentArgs[depIndex]

		// Check specific values if provided
		if (dep.values && !dep.values.includes(depValue)) {
			missing.push(dep.argumentName)
			continue
		}

		// Check custom condition if provided
		if (dep.condition) {
			const context = createProviderContext(command, currentArgs, depIndex, "")
			if (!dep.condition(depValue, context)) {
				missing.push(dep.argumentName)
			}
		}
	}

	return {
		satisfied: missing.length === 0,
		missing,
	}
}

/**
 * Detect what the user is currently typing
 */
export function detectInputState(input: string): InputState {
	const parsed = parseCommand(input)

	// Special case: just "/" should show all commands
	if (!parsed && input.trim() === "/") {
		return { type: "command", commandName: "" }
	}

	if (!parsed) {
		return { type: "none" }
	}

	const command = commandRegistry.get(parsed.command)

	if (!command) {
		return { type: "command", commandName: parsed.command }
	}

	// Check if typing an option
	const lastToken = input.trim().split(/\s+/).pop() || ""
	if (lastToken.startsWith("-")) {
		return {
			type: "option",
			commandName: command.name,
			command,
		}
	}

	// Check if command has arguments defined
	if (!command.arguments || command.arguments.length === 0) {
		// No arguments defined, stay in command mode
		return {
			type: "command",
			commandName: command.name,
			command,
		}
	}

	// Determine which argument is being typed
	// If input ends with space, user is ready to type the NEXT argument
	// If input doesn't end with space, user is still typing the CURRENT argument
	const endsWithSpace = input.endsWith(" ")
	const argumentIndex = endsWithSpace ? parsed.args.length : Math.max(0, parsed.args.length - 1)
	const argumentDef = command.arguments[argumentIndex]

	// If no argument definition exists for this index, return command type
	if (!argumentDef) {
		return {
			type: "command",
			commandName: command.name,
			command,
		}
	}

	// Check dependencies
	const dependencies = checkDependencies(argumentDef, parsed.args, command)

	return {
		type: "argument",
		commandName: command.name,
		command,
		currentArgument: {
			definition: argumentDef,
			index: argumentIndex,
			partialValue: parsed.args[argumentIndex] || "",
		},
		dependencies,
	}
}

// ============================================================================
// ARGUMENT SUGGESTIONS
// ============================================================================

/**
 * Create provider context
 */
function createProviderContext(
	command: Command,
	currentArgs: string[],
	argumentIndex: number,
	partialInput: string,
	commandContext?: ArgumentProviderCommandContext,
): ArgumentProviderContext {
	const argumentDef = command.arguments?.[argumentIndex]

	// Build args map by name
	const argsMap: Record<string, string> = {}
	command.arguments?.forEach((arg, idx) => {
		if (currentArgs[idx]) {
			argsMap[arg.name] = currentArgs[idx]
		}
	})

	const baseContext: ArgumentProviderContext = {
		commandName: command.name,
		argumentIndex,
		argumentName: argumentDef?.name || "",
		currentArgs,
		currentOptions: {},
		partialInput,
		getArgument: (name: string) => argsMap[name],
		parsedValues: {
			args: argsMap,
			options: {},
		},
		command,
	}

	if (commandContext) {
		baseContext.commandContext = {
			config: commandContext.config,
			routerModels: commandContext.routerModels || null,
			currentProvider: commandContext.currentProvider || null,
			kilocodeDefaultModel: commandContext.kilocodeDefaultModel || "",
			profileData: commandContext.profileData || null,
			profileLoading: commandContext.profileLoading || false,
			updateProviderModel: commandContext.updateProviderModel,
			refreshRouterModels: commandContext.refreshRouterModels,
			taskHistoryData: commandContext.taskHistoryData || null,
			chatMessages: commandContext.chatMessages || [],
			customModes: commandContext.customModes || [],
		}
	}

	return baseContext
}

/**
 * Get the appropriate provider for an argument
 */
function getProvider(
	definition: ArgumentDefinition,
	command: Command,
	currentArgs: string[],
	argumentIndex: number,
	commandContext?: ArgumentProviderCommandContext,
): ArgumentProvider | null {
	// Check conditional providers
	if (definition.conditionalProviders) {
		const context = createProviderContext(command, currentArgs, argumentIndex, "", commandContext)
		for (const cp of definition.conditionalProviders) {
			if (cp.condition(context)) {
				return cp.provider
			}
		}
	}

	// Use default provider
	if (definition.provider) {
		return definition.provider
	}

	// Use static values
	if (definition.values) {
		return async () =>
			definition.values!.map((v) => ({
				value: v.value,
				description: v.description || "",
				matchScore: 1,
				highlightedValue: v.value,
			}))
	}

	// Use default provider if available
	if (definition.defaultProvider) {
		return definition.defaultProvider
	}

	return null
}

/**
 * Execute a provider and normalize results
 */
async function executeProvider(
	provider: ArgumentProvider,
	context: ArgumentProviderContext,
): Promise<ArgumentSuggestion[]> {
	const results = await provider(context)

	// Normalize results
	return results.map((r) => {
		if (typeof r === "string") {
			return {
				value: r,
				description: "",
				matchScore: 1,
				highlightedValue: r,
			}
		}
		return r
	})
}

/**
 * Filter and score suggestions based on partial input
 */
function filterAndScore(suggestions: ArgumentSuggestion[], query: string): ArgumentSuggestion[] {
	if (!query) {
		return suggestions
	}

	// Reuse or create Fuse instance for these arguments
	// Note: Since arguments change often, we might not want to cache the Fuse instance persistently 
	// unless the suggestions array is reference-stable.
	// For now, we create a fresh one or check a simple cache (omitted for safety).
	// Actually, let's use a new Fuse instance for arguments to ensure correctness, 
	// as arguments lists are usually small matching operations.

	// Performance Note: For small lists (<100 items), creating new Fuse is negligible.
	const fuse = new Fuse(suggestions, {
		...FUSE_OPTIONS,
		keys: ["value", "description"]
	})

	const results = fuse.search(query)

	const fuseMapped = results.map(result => ({
		...result.item,
		matchScore: result.score !== undefined ? (1 - result.score) * 100 : 0,
		highlightedValue: highlightMatch(result.item.value, result.matches?.find(m => m.key === "value")?.indices)
	}))

	// Fallback for arguments
	if (fuseMapped.length === 0) {
		const lowerQuery = query.toLowerCase()
		return suggestions.filter(s => s.value.toLowerCase().includes(lowerQuery) || s.description?.toLowerCase().includes(lowerQuery))
			.map(s => ({
				...s,
				matchScore: s.value.toLowerCase().startsWith(lowerQuery) ? 90 : 50,
				highlightedValue: s.value
			}))
			.sort((a, b) => b.matchScore - a.matchScore)
	}

	return fuseMapped.sort((a, b) => b.matchScore - a.matchScore)
}

/**
 * Generate cache key
 */
function getCacheKey(definition: ArgumentDefinition, command: Command, index: number, partialValue: string): string {
	if (definition.cache?.keyGenerator) {
		const context = createProviderContext(command, [], index, partialValue)
		return definition.cache.keyGenerator(context)
	}

	return `${command.name}:${definition.name}:${partialValue}`
}

/**
 * Get argument suggestions for current input
 */
export async function getArgumentSuggestions(
	input: string,
	commandContext?: ArgumentProviderCommandContext,
): Promise<ArgumentSuggestion[]> {
	const state = detectInputState(input)

	if (state.type !== "argument" || !state.currentArgument) {
		return []
	}

	const { definition, index, partialValue } = state.currentArgument

	// Check dependencies
	if (state.dependencies && !state.dependencies.satisfied) {
		return [
			{
				value: "",
				description: `Missing dependencies: ${state.dependencies.missing.join(", ")}`,
				matchScore: 0,
				highlightedValue: "",
				error: "Dependencies not satisfied",
			},
		]
	}

	// Execute provider
	const parsed = parseCommand(input)
	const currentArgs = parsed?.args || []

	// Get provider with current args context
	const provider = getProvider(definition, state.command!, currentArgs, index, commandContext)

	if (!provider) {
		return []
	}

	// Check cache
	const cacheKey = getCacheKey(definition, state.command!, index, partialValue)
	if (definition.cache?.enabled) {
		const cached = cache.get(cacheKey)
		if (cached) {
			return filterAndScore(cached, partialValue)
		}
	}

	// Create context for provider execution
	const context = createProviderContext(state.command!, currentArgs, index, partialValue, commandContext)

	try {
		const results = await executeProvider(provider, context)

		// Cache results
		if (definition.cache?.enabled) {
			const ttl = definition.cache.ttl || 60000 // 1 minute default
			cache.set(cacheKey, results, ttl)
		}

		return filterAndScore(results, partialValue)
	} catch (error) {
		return [
			{
				value: "",
				description: "Error loading suggestions",
				matchScore: 0,
				highlightedValue: "",
				error: error instanceof Error ? error.message : "Unknown error",
			},
		]
	}
}

/**
 * Clear argument suggestion cache
 */
export function clearArgumentCache(): void {
	cache.clear()
}

// ============================================================================
// FILE MENTION DETECTION & SUGGESTIONS
// ============================================================================

/**
 * Detect if cursor is within a file mention context
 * Scans backward from cursor position to find '@' symbol
 * @param text Full text buffer
 * @param cursorPosition Current cursor position
 * @returns File mention context or null if not in mention
 */
export function detectFileMentionContext(text: string, cursorPosition: number): FileMentionContext | null {
	// Scan backward from cursor to find '@'
	let mentionStart = -1

	for (let i = cursorPosition - 1; i >= 0; i--) {
		const char = text[i]

		// Found '@' - this is our mention start
		if (char === "@") {
			mentionStart = i
			break
		}

		// If we hit whitespace or newline before '@', no mention context
		if (char === " " || char === "\n" || char === "\t" || char === "\r") {
			return null
		}
	}

	// No '@' found before cursor
	if (mentionStart === -1) {
		return null
	}

	// Extract query between '@' and cursor
	const query = text.slice(mentionStart + 1, cursorPosition)

	// Check if query contains unescaped whitespace (not a valid mention)
	// Use negative lookbehind to check for whitespace not preceded by backslash
	if (/(?<!\\)\s/.test(query)) {
		return null
	}

	return {
		isInMention: true,
		mentionStart,
		query,
	}
}

/**
 * Get file mention suggestions based on query
 * @param query Search query (text after @)
 * @param cwd Current working directory (workspace root)
 * @param maxResults Maximum number of results (default: 50)
 * @returns Array of file mention suggestions
 */
export async function getFileMentionSuggestions(
	query: string,
	cwd: string,
	maxResults = 50,
): Promise<FileMentionSuggestion[]> {
	try {
		// Search files using file search service
		const results = await fileSearchService.searchFiles(query, cwd, maxResults)

		// Convert to FileMentionSuggestion format
		return results.map((result) => {
			const suggestion: FileMentionSuggestion = {
				value: result.path,
				matchScore: 100, // fileSearchService already sorts by relevance
				highlightedValue: result.path,
				type: result.type,
			}

			if (result.dirname) {
				suggestion.description = `in ${result.dirname}`
			}

			return suggestion
		})
	} catch (error) {
		return [
			{
				value: "",
				description: "Error loading file suggestions",
				matchScore: 0,
				highlightedValue: "",
				type: "file",
				error: error instanceof Error ? error.message : "Unknown error",
			},
		]
	}
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Get all suggestions (commands, arguments, or file mentions) based on input state
 * @param input Current input text
 * @param cursorPosition Current cursor position (required for file mention detection)
 * @param commandContext Optional command context for argument providers
 * @param cwd Current working directory for file suggestions
 */
export async function getAllSuggestions(
	input: string,
	cursorPosition: number,
	commandContext?: ArgumentProviderCommandContext,
	cwd?: string,
): Promise<
	| { type: "command"; suggestions: CommandSuggestion[] }
	| { type: "argument"; suggestions: ArgumentSuggestion[] }
	| { type: "file-mention"; suggestions: FileMentionSuggestion[] }
	| { type: "none"; suggestions: [] }
> {
	// Check for file mention context first (highest priority)
	const fileMentionCtx = detectFileMentionContext(input, cursorPosition)
	if (fileMentionCtx?.isInMention && cwd) {
		return {
			type: "file-mention",
			suggestions: await getFileMentionSuggestions(fileMentionCtx.query, cwd),
		}
	}

	// Fall back to command/argument detection
	const state = detectInputState(input)

	if (state.type === "command") {
		return {
			type: "command",
			suggestions: getSuggestions(input),
		}
	}

	if (state.type === "argument") {
		return {
			type: "argument",
			suggestions: await getArgumentSuggestions(input, commandContext),
		}
	}

	return {
		type: "none",
		suggestions: [],
	}
}
