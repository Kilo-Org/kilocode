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

// ============================================================================
// SHARED UTILITIES - Scoring & Matching
// ============================================================================

/**
 * Simple fuzzy matching algorithm
 * Returns a score between 0 and 1
 */
function fuzzyMatch(text: string, query: string): number {
	let textIndex = 0
	let queryIndex = 0
	let matches = 0

	while (textIndex < text.length && queryIndex < query.length) {
		if (text[textIndex] === query[queryIndex]) {
			matches++
			queryIndex++
		}
		textIndex++
	}

	return queryIndex === query.length ? matches / text.length : 0
}

/**
 * Calculate match score for text against query
 * Higher score = better match
 * Used for both commands and arguments
 */
function calculateMatchScore(
	text: string,
	query: string,
	context?: { isCommand?: boolean; description?: string },
): number {
	// If query is empty, return a default score
	if (!query) {
		return context?.isCommand ? 50 : 100
	}

	const lowerText = text.toLowerCase()
	const lowerQuery = query.toLowerCase()

	// Exact match
	if (lowerText === lowerQuery) {
		return 100
	}

	// Starts with query
	if (lowerText.startsWith(lowerQuery)) {
		return 90
	}

	// For commands, check aliases
	if (context?.isCommand) {
		// This will be handled by the command-specific function
	}

	// Contains query
	if (lowerText.includes(lowerQuery)) {
		return 70
	}

	// Description contains query (for commands)
	if (context?.description && context.description.toLowerCase().includes(lowerQuery)) {
		return 50
	}

	// Fuzzy match
	const fuzzyScore = fuzzyMatch(lowerText, lowerQuery)
	if (fuzzyScore > 0.5) {
		return Math.floor(fuzzyScore * 40)
	}

	return 0
}

/**
 * Highlight matching parts of text
 * For now, just returns the text - UI handles highlighting
 */
function highlightMatch(text: string): string {
	return text
}

// ============================================================================
// COMMAND SUGGESTIONS
// ============================================================================

/**
 * Calculate match score for a command
 * Higher score = better match
 *
 * Note: Exact matches return score 100 and are included in suggestions.
 * This allows users to see visual confirmation that they've typed a valid command.
 */
function calculateCommandMatchScore(command: Command, query: string): number {
	// If query is empty, return a default score to show all commands
	if (!query) {
		return 50
	}

	const name = command.name.toLowerCase()
	const description = command.description.toLowerCase()

	// Exact match - return highest score to show user they've typed a valid command
	if (name === query) {
		return 100
	}

	// Starts with query
	if (name.startsWith(query)) {
		return 90
	}

	// Check aliases
	for (const alias of command.aliases) {
		const lowerAlias = alias.toLowerCase()
		if (lowerAlias === query) {
			return 85
		}
		if (lowerAlias.startsWith(query)) {
			return 80
		}
	}

	// Contains query
	if (name.includes(query)) {
		return 70
	}

	// Description contains query
	if (description.includes(query)) {
		return 50
	}

	// Fuzzy match
	const fuzzyScore = fuzzyMatch(name, query)
	if (fuzzyScore > 0.5) {
		return Math.floor(fuzzyScore * 40)
	}

	return 0
}

/**
 * Get command suggestions based on input
 */
export function getSuggestions(input: string): CommandSuggestion[] {
	// Remove leading slash
	const query = input.startsWith("/") ? input.slice(1) : input

	// Get matching commands
	const matches: CommandSuggestion[] = []
	const lowerQuery = query.toLowerCase()

	for (const command of commandRegistry.getAll()) {
		const score = calculateCommandMatchScore(command, lowerQuery)
		if (score === 0) continue
		matches.push({
			command,
			matchScore: score,
			highlightedName: highlightMatch(command.name),
		})
	}

	// Sort by match score (descending), then by priority (descending), then alphabetically
	matches.sort((a, b) => {
		// Primary: Sort by match score (descending)
		if (b.matchScore !== a.matchScore) {
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

	return matches
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

	const lowerQuery = query.toLowerCase()

	return suggestions
		.map((s) => ({
			...s,
			matchScore: calculateMatchScore(s.value, lowerQuery),
			highlightedValue: highlightMatch(s.value),
		}))
		.filter((s) => s.matchScore > 0)
		.sort((a, b) => b.matchScore - a.matchScore)
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
