/**
 * /session command - Manage session information
 */

import { generateMessage } from "../ui/utils/messages.js"
import type { Command, CommandContext, ArgumentProviderContext, ArgumentSuggestion } from "./core/types.js"
import { formatRelativeTime } from "../utils/time.js"
import { SessionManager } from "../../../src/shared/kilocode/cli-sessions/core/SessionManager.js"

/**
 * Show current session ID
 */
async function showSessionId(context: CommandContext): Promise<void> {
	const { addMessage } = context

	const sessionService = SessionManager.init()
	const sessionId = sessionService?.sessionId

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
	const sessionService = SessionManager.init()

	try {
		const result = await sessionService?.listSessions({ limit: 50 })
		if (!result || result.cliSessions.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content: "No sessions found.",
			})
			return
		}

		const { cliSessions } = result

		// Format and display sessions
		let content = `**Available Sessions:**\n\n`
		cliSessions.forEach((session, index) => {
			const isActive = session.session_id === sessionService?.sessionId ? " * [Active]" : ""
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
	const sessionService = SessionManager.init()

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
		await sessionService?.restoreSession(sessionId, true)

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
 * Search sessions by title or ID
 */
async function searchSessions(context: CommandContext, query: string): Promise<void> {
	const { addMessage } = context
	const sessionService = SessionManager.init()

	if (!query) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /session search <query>",
		})
		return
	}

	try {
		const result = await sessionService?.searchSessions({ search_string: query, limit: 20 })

		if (!result || result.results.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content: `No sessions found matching "${query}".`,
			})
			return
		}

		const { results, total } = result

		let content = `**Search Results** (${results.length} of ${total}):\n\n`
		results.forEach((session, index) => {
			const isActive = session.session_id === sessionService?.sessionId ? " * [Active]" : ""
			const title = session.title || "Untitled"
			const createdTime = formatRelativeTime(new Date(session.created_at).getTime())

			content += `${index + 1}. **${title}**${isActive}\n`
			content += `   ID: \`${session.session_id}\`\n`
			content += `   Created: ${createdTime}\n\n`
		})

		addMessage({
			...generateMessage(),
			type: "system",
			content,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to search sessions: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Share the current session publicly with git state
 */
async function shareSession(context: CommandContext): Promise<void> {
	const { addMessage } = context
	const sessionService = SessionManager.init()

	try {
		const result = await sessionService?.shareSession()

		if (!result) {
			throw new Error("SessionManager not initialized")
		}

		addMessage({
			...generateMessage(),
			type: "system",
			content: `✅ Session shared successfully!\n\n\`https://app.kilo.ai/share/${result.share_id}\``,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to share session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Fork a shared session by share ID
 */
async function forkSession(context: CommandContext, id: string): Promise<void> {
	const { addMessage, replaceMessages, refreshTerminal } = context
	const sessionService = SessionManager.init()

	if (!id) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /session fork <id>",
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
				content: `Forking session from ID \`${id}\`...`,
				ts: 2,
			},
		])

		await refreshTerminal()

		await sessionService?.forkSession(id, true)

		// Success message handled by restoreSession via extension messages
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to fork session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Delete a session by ID
 */
async function deleteSession(context: CommandContext, sessionId: string): Promise<void> {
	const { addMessage } = context
	const sessionService = SessionManager.init()

	if (!sessionId) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /session delete <sessionId>",
		})
		return
	}

	try {
		if (!sessionService) {
			throw new Error("SessionManager used before initialization")
		}

		await sessionService.deleteSession({ session_id: sessionId })

		addMessage({
			...generateMessage(),
			type: "system",
			content: `✅ Session \`${sessionId}\` deleted successfully.`,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Rename the current session
 */
async function renameSession(context: CommandContext, newName: string): Promise<void> {
	const { addMessage } = context
	const sessionService = SessionManager.init()

	if (!newName) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: "Usage: /session rename <new name>",
		})
		return
	}

	try {
		if (!sessionService?.sessionId) {
			throw new Error("No active session to rename")
		}

		await sessionService.renameSession(sessionService.sessionId, newName)

		addMessage({
			...generateMessage(),
			type: "system",
			content: `✅ Session renamed to "${newName}".`,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to rename session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Autocomplete provider for session IDs
 */
async function sessionIdAutocompleteProvider(context: ArgumentProviderContext): Promise<ArgumentSuggestion[]> {
	const sessionService = SessionManager.init()

	// Extract prefix from user input
	const prefix = context.partialInput.trim()

	// Return empty array if no input
	if (!prefix) {
		return []
	}

	try {
		const response = await sessionService?.searchSessions({ search_string: prefix, limit: 20 })

		if (!response) {
			return []
		}

		return response.results.map((session, index) => {
			const title = session.title || "Untitled"
			const truncatedTitle = title.length > 50 ? `${title.slice(0, 47)}...` : title

			const description = session.title
				? `${truncatedTitle} | Created: ${new Date(session.created_at).toLocaleDateString()}`
				: `Created: ${new Date(session.created_at).toLocaleDateString()}`

			return {
				value: session.session_id,
				description,
				matchScore: 100 - index, // Backend orders by updated_at DESC, preserve order
				highlightedValue: session.session_id,
			}
		})
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
		"/session search <query>",
		"/session select <sessionId>",
		"/session share",
		"/session fork <id>",
		"/session delete <sessionId>",
		"/session rename <new name>",
	],
	category: "system",
	priority: 5,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: show, list, search, select, share, fork, delete, rename",
			required: false,
			values: [
				{ value: "show", description: "Display current session ID" },
				{ value: "list", description: "List all sessions" },
				{ value: "search", description: "Search sessions by title or ID" },
				{ value: "select", description: "Restore a session" },
				{ value: "share", description: "Share current session publicly" },
				{ value: "fork", description: "Fork a session" },
				{ value: "delete", description: "Delete a session" },
				{ value: "rename", description: "Rename the current session" },
			],
		},
		{
			name: "argument",
			description: "Argument for the subcommand",
			required: false,
			provider: sessionIdAutocompleteProvider,
			conditionalProviders: [
				{
					condition: (context) => {
						const subcommand = context.getArgument("subcommand")
						return subcommand === "select" || subcommand === "delete"
					},
					provider: sessionIdAutocompleteProvider,
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
				content: "Usage: /session [show|list|search|select|share|fork|delete|rename] [args]",
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
			case "search":
				await searchSessions(context, args[1] || "")
				break
			case "select":
				await selectSession(context, args[1] || "")
				break
			case "share":
				await shareSession(context)
				break
			case "fork":
				await forkSession(context, args[1] || "")
				break
			case "delete":
				await deleteSession(context, args[1] || "")
				break
			case "rename":
				await renameSession(context, args.slice(1).join(" "))
				break
			default:
				addMessage({
					...generateMessage(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: show, list, search, select, share, fork, delete, rename`,
				})
		}
	},
}
