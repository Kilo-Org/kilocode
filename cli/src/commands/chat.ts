/**
 * /chat command - Chat session management
 * Local chat session persistence and management
 */

import { promises as fs } from "fs"
import path from "path"
import { generateMessage } from "../ui/utils/messages.js"
import type { Command, CommandContext } from "./core/types.js"
import type { CliMessage } from "../types/cli.js"
import { formatRelativeTime } from "../utils/time.js"

// Define the path for chat session storage
const CHAT_SESSIONS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "", ".kilocode", "cli", "chats")

interface SavedChatSession {
	name: string
	timestamp: number
	created: string
	messages: CliMessage[]
	context: {
		mode: string
		provider?: string
		theme?: string
		task?: unknown
	}
	metadata: {
		messageCount: number
		lastMessageTime?: number
		sessionId?: string
	}
}

/**
 * Ensure the chat sessions directory exists
 */
async function ensureChatDirectory(): Promise<void> {
	try {
		await fs.mkdir(CHAT_SESSIONS_DIR, { recursive: true })
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code !== "EEXIST") {
			throw error
		}
	}
}

/**
 * Get all saved chat sessions
 */
async function getSavedSessions(): Promise<SavedChatSession[]> {
	await ensureChatDirectory()

	try {
		const files = await fs.readdir(CHAT_SESSIONS_DIR)
		const sessions: SavedChatSession[] = []

		for (const file of files) {
			if (file.endsWith(".json")) {
				try {
					const filePath = path.join(CHAT_SESSIONS_DIR, file)
					const data = await fs.readFile(filePath, "utf-8")
					const session = JSON.parse(data) as SavedChatSession
					sessions.push(session)
				} catch (error) {
					console.warn(`Failed to read session file ${file}:`, error)
				}
			}
		}

		return sessions.sort((a, b) => b.timestamp - a.timestamp)
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return []
		}
		throw error
	}
}

/**
 * Save current chat session
 */
async function saveChatSession(context: CommandContext, name: string): Promise<void> {
	const { addMessage, chatMessages } = context

	if (!name) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: 'Usage: /chat save "session_name"',
		})
		return
	}

	// Validate session name
	const invalidChars = /[<>:"/\\|?*]/
	if (invalidChars.test(name)) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: 'Session name contains invalid characters. Please avoid: < > : " / \\ | ? *',
		})
		return
	}

	try {
		await ensureChatDirectory()

		// Get current chat messages from context
		const messages = (chatMessages as unknown as CliMessage[]) || []

		if (messages.length === 0) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: "No chat messages to save. Start a conversation first.",
			})
			return
		}

		// Extract relevant context from messages if available
		const lastMessage = messages[messages.length - 1]
		const sessionContext = {
			mode: "code", // Default mode, could be enhanced to extract from context
		}

		const session: SavedChatSession = {
			name,
			timestamp: Date.now(),
			created: new Date().toISOString(),
			messages: [...messages], // Deep copy messages
			context: sessionContext,
			metadata: {
				messageCount: messages.length,
				...(lastMessage && typeof lastMessage.ts === "number" && { lastMessageTime: lastMessage.ts }),
			},
		}

		// Save to file
		const fileName = `${name.replace(/[^a-zA-Z0-9-_]/g, "_")}.json`
		const filePath = path.join(CHAT_SESSIONS_DIR, fileName)

		await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8")

		addMessage({
			...generateMessage(),
			type: "system",
			content: `✅ Chat session "${name}" saved successfully!\n\n**Details:**\n• Messages: ${session.metadata.messageCount}\n• Created: ${new Date(session.timestamp).toLocaleString()}\n• File: ${filePath}`,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to save chat session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * List all saved chat sessions
 */
async function listChatSessions(context: CommandContext): Promise<void> {
	const { addMessage } = context

	try {
		const sessions = await getSavedSessions()

		if (sessions.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content: 'No saved chat sessions found. Use `/chat save "name"` to save the current chat.',
			})
			return
		}

		let content = `**Saved Chat Sessions** (${sessions.length}):\n\n`

		sessions.forEach((session, index) => {
			const relativeTime = formatRelativeTime(session.timestamp)
			const truncatedName = session.name.length > 50 ? `${session.name.slice(0, 47)}...` : session.name

			content += `${index + 1}. **${truncatedName}**\n`
			content += `   Messages: ${session.metadata.messageCount}\n`
			content += `   Created: ${relativeTime}\n`
			content += `   Mode: ${session.context.mode}\n`
			if (session.context.provider) {
				content += `   Provider: ${session.context.provider}\n`
			}
			content += `   File: ${session.name.replace(/[^a-zA-Z0-9-_]/g, "_")}.json\n\n`
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
			content: `Failed to list chat sessions: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Resume a saved chat session
 */
async function resumeChatSession(context: CommandContext, name: string): Promise<void> {
	const { addMessage, replaceMessages, refreshTerminal, setMode } = context

	if (!name) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: 'Usage: /chat resume "session_name"',
		})
		return
	}

	try {
		const sessions = await getSavedSessions()
		const fileName = `${name.replace(/[^a-zA-Z0-9-_]/g, "_")}.json`

		// Try exact name match first
		let session = sessions.find((s) => s.name === name)

		// If not found, try file name match
		if (!session) {
			session = sessions.find((s) => s.name.replace(/[^a-zA-Z0-9-_]/g, "_") + ".json" === fileName)
		}

		if (!session) {
			addMessage({
				...generateMessage(),
				type: "error",
				content: `Chat session "${name}" not found. Use \`/chat list\` to see available sessions.`,
			})
			return
		}

		// Show loading state
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
				content: `Restoring chat session "${session.name}"...`,
				ts: 2,
			},
		])

		await refreshTerminal()

		// Restore messages
		const restoredMessages = session.messages.map((msg, index) => ({
			...msg,
			ts: now + index + 10, // Offset timestamps to ensure ordering
		}))

		replaceMessages(restoredMessages)

		// Restore context
		if (session.context.mode) {
			setMode(session.context.mode)
		}

		addMessage({
			...generateMessage(),
			type: "system",
			content: `✅ Chat session "${session.name}" restored successfully!\n\n**Session Details:**\n• Messages: ${session.metadata.messageCount}\n• Original created: ${new Date(session.timestamp).toLocaleString()}\n• Mode: ${session.context.mode}\n\nThe conversation has been restored to the exact state when it was saved.`,
		})
	} catch (error) {
		addMessage({
			...generateMessage(),
			type: "error",
			content: `Failed to resume chat session: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

/**
 * Clear all context and conversation state
 */
async function _clearContext(_context: CommandContext): Promise<void> {
	// Function kept for completeness but moved to separate file
	// Implementation moved to clearcontext.ts
}

export const chatCommand: Command = {
	name: "chat",
	aliases: ["c"],
	description: "Manage chat sessions (save, list, resume) and clear context",
	usage: '/chat [save "name"|list|resume "name"]',
	examples: ['/chat save "my session"', "/chat list", '/chat resume "my session"', "/clearcontext"],
	category: "chat",
	priority: 6,
	arguments: [
		{
			name: "action",
			description: "Action: save, list, resume",
			required: false,
			values: [
				{ value: "save", description: "Save current chat session" },
				{ value: "list", description: "List all saved sessions" },
				{ value: "resume", description: "Resume a saved session" },
			],
		},
		{
			name: "session_name",
			description: "Session name for save/resume actions",
			required: false,
			placeholder: 'Enter session name (e.g., "my session")',
		},
	],
	handler: async (context) => {
		const { args, addMessage } = context

		if (args.length === 0) {
			addMessage({
				...generateMessage(),
				type: "system",
				content:
					'**Chat Session Management**\n\nAvailable commands:\n• `/chat save "name"` - Save current chat session\n• `/chat list` - List all saved sessions\n• `/chat resume "name"` - Resume a saved session\n• `/clearcontext` - Clear all context\n\nUse `/help chat` for detailed examples.',
			})
			return
		}

		const action = args[0]?.toLowerCase()

		switch (action) {
			case "save":
				await saveChatSession(context, args.slice(1).join(" ").replace(/^"|"$/g, ""))
				break
			case "list":
				await listChatSessions(context)
				break
			case "resume":
				await resumeChatSession(context, args.slice(1).join(" ").replace(/^"|"$/g, ""))
				break
			default:
				addMessage({
					...generateMessage(),
					type: "error",
					content: `Unknown action "${action}". Available: save, list, resume. Use \`/clearcontext\` to clear all context.`,
				})
		}
	},
}
