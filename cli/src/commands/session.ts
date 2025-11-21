/**
 * /session command - Manage session information
 */

import { generateMessage } from "../ui/utils/messages.js"
import type { Command, CommandContext, ArgumentProviderContext, ArgumentSuggestion } from "./core/types.js"
import { SessionService } from "../services/session.js"
import { SessionClient, CliSessionSharedState } from "../services/sessionClient.js"

/**
 * Get all valid share state values from the enum
 */
function getValidShareStates(): string[] {
	return Object.values(CliSessionSharedState)
}

/**
 * Check if a value is a valid share state
 */
function isValidShareState(value: string): value is CliSessionSharedState {
	return getValidShareStates().includes(value)
}

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(ts: number): string {
	const now = Date.now()
	const diff = now - ts
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) return `${days}d ago`
	if (hours > 0) return `${hours}h ago`
	if (minutes > 0) return `${minutes}m ago`
	return "just now"
}

/**
 * Show current session ID
 */
async function showSessionId(context: CommandContext): Promise<void> {
	const { addMessage } = context

	const sessionService = SessionService.init()
	const sessionId = sessionService.sessionId

	if (!sessionId) {
		addMessage({
			...generateMessage(),
			type: "system",
			content: "No active session. Start a new task to create a session.",
		})
		return
	}

	addMessage({
		...generateMessage(),
		type: "system",
		content: `**Current Session ID:** ${sessionId}`,
	})
}

/**
 * List all sessions
 */
async function listSessions(context: CommandContext): Promise<void> {
	const { addMessage } = context
	const sessionService = SessionService.init()
	const sessionClient = SessionClient.getInstance()

	try {
		const result = await sessionClient.list({ limit: 50 })
		const { cliSessions } = result

		if (cliSessions.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content: "No sessions found.",
			})
			return
		}

		// Format and display sessions
		let content = `**Available Sessions:**\n\n`
		cliSessions.forEach((session, index) => {
			const isActive = session.session_id === sessionService.sessionId ? " 🟢 [Active]" : ""
			const title = session.title || "Untitled"
			const createdTime = formatRelativeTime(new Date(session.created_at).getTime())

			content += `${index + 1}. **${title}**${isActive}\n`
			content += `   ID: \`${session.session_id}\`\n`
			content += `   Created: ${createdTime}\n\n`
		})

		if (result.nextCursor) {
			content += `\n_Showing first ${cliSessions.length} sessions. More available._`
		}

		addMessage({
			...generateMessage(),
			type: "system",
			content,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Select a specific session
 */
async function selectSession(context: CommandContext, sessionId: string): Promise<void> {
	const { addMessage, replaceMessages, refreshTerminal } = context
	const sessionService = SessionService.init()

	if (!sessionId) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /session select <sessionId>",
		})
		return
	}

	try {
		// Clear messages and show loading state
		const now = Date.now()
		replaceMessages([
			{
				id: `empty-${now}`,
				type: "empty",
				content: "",
				ts: 1,
			},
			{
				id: `system-${now + 1}`,
				type: "system",
				content: `Restoring session \`${sessionId}\`...`,
				ts: 2,
			},
		])

		await refreshTerminal()
		await sessionService.restoreSession(sessionId, true)

		// Success message is handled by restoreSession via extension messages
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to restore session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Share a session (make it public or private)
 */
async function shareSession(context: CommandContext): Promise<void> {
	const { addMessage, args } = context
	const sessionService = SessionService.init()

	// Parse the share state argument (default to "public")
	const stateArg = args[1]?.toLowerCase() || CliSessionSharedState.Public

	// Validate the state value
	if (!isValidShareState(stateArg)) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Invalid share state "${stateArg}". Must be one of: ${getValidShareStates().join(", ")}.`,
		})
		return
	}

	try {
		const result = await sessionService.setSharedState(stateArg)
		const sessionId = result.session.session_id

		addMessage({
			...generateMessage(),
			type: "system",
			content: `Session shared at: https://kilo.ai/session/${sessionId}`,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to set share state: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Autocomplete provider for session IDs
 */
async function sessionIdAutocompleteProvider(context: ArgumentProviderContext): Promise<ArgumentSuggestion[]> {
	const sessionClient = SessionClient.getInstance()

	// Extract prefix from user input
	const prefix = context.partialInput.trim()

	// Return empty array if no input
	if (!prefix) {
		return []
	}

	try {
		const response = await sessionClient.search({ searchString: prefix, limit: 20 })
		return response.results.map((session, index) => ({
			value: session.session_id,
			title: session.title || "Untitled",
			description: `Created: ${new Date(session.created_at).toLocaleDateString()}`,
			matchScore: 100 - index, // Backend orders by updated_at DESC, preserve order
			highlightedValue: session.session_id,
		}))
	} catch (_error) {
		return []
	}
}

export const sessionCommand: Command = {
	name: "session",
	aliases: [],
	description: "Manage sessions",
	usage: "/session [subcommand] [args]",
	examples: [
		"/session show",
		"/session list",
		"/session select <sessionId>",
		"/session share",
		"/session share public",
		"/session share private",
	],
	category: "system",
	priority: 5,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: show, list, select, share",
			required: false,
			values: [
				{ value: "show", description: "Display current session ID" },
				{ value: "list", description: "List all sessions" },
				{ value: "select", description: "Restore a session" },
				{ value: "share", description: "Share session" },
			],
		},
		{
			name: "argument",
			description: "Argument for the subcommand",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => context.getArgument("subcommand") === "select",
					provider: sessionIdAutocompleteProvider,
				},
				{
					condition: (context) => context.getArgument("subcommand") === "share",
					provider: async () =>
						getValidShareStates().map((value) => ({
							value,
							description: `Make session ${value}`,
							matchScore: 100,
							highlightedValue: value,
						})),
				},
			],
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context

		if (args.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content: "Usage: /session [show|list|select|share] [args]",
			})
			return
		}

		const subcommand = args[0]?.toLowerCase()

		switch (subcommand) {
			case "show":
				await showSessionId(context)
				break
			case "list":
				await listSessions(context)
				break
			case "select":
				await selectSession(context, args[1] || "")
				break
			case "share":
				await shareSession(context)
				break
			default:
				addMessage({
					...generateMessage(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: show, list, select, share`,
				})
		}
	},
}
