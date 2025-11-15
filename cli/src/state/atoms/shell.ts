/**
 * Jotai atoms for shell mode state management
 */

import { atom } from "jotai"
import { addMessageAtom, inputModeAtom, type InputMode } from "./ui.js"
import { clearTextAtom, setTextAtom, textBufferIsEmptyAtom } from "./textBuffer.js"
import { ShellSession } from "../../services/shell/session.js"
import { logs } from "../../services/logs.js"

// ============================================================================
// Workspace Path Atom
// ============================================================================

/**
 * The workspace directory where shell commands should be executed
 */
export const workspacePathAtom = atom<string | null>(null)

/**
 * Global shell session instance for persistent shell mode
 */
export const shellSessionAtom = atom<ShellSession | null>(null)

/**
 * Current directory of the persistent shell session
 */
export const currentShellDirectoryAtom = atom<string>(process.cwd())

// ============================================================================
// Shell Mode Atoms
// ============================================================================

/**
 * Whether shell mode is currently active
 */
export const shellModeActiveAtom = atom<boolean>(false)

/**
 * Shell command history
 */
export const shellHistoryAtom = atom<string[]>([])

/**
 * Current shell history index (for navigation)
 */
export const shellHistoryIndexAtom = atom<number>(-1)

/**
 * Action atom to initialize shell session
 */
export const initializeShellSessionAtom = atom(null, async (get, set) => {
	const session = get(shellSessionAtom)
	if (session) return // Already initialized

	const workspacePath = get(workspacePathAtom) || process.cwd()
	const newSession = new ShellSession()

	await newSession.ensureSession(workspacePath)
	set(shellSessionAtom, newSession)
	set(currentShellDirectoryAtom, workspacePath)
})

/**
 * Action atom to dispose shell session
 */
export const disposeShellSessionAtom = atom(null, (get, set) => {
	const session = get(shellSessionAtom)
	if (session) {
		session.dispose()
		set(shellSessionAtom, null)
		set(currentShellDirectoryAtom, process.cwd())
	}
})

/**
 * Action atom to apply shell workspace changes when exiting shell mode
 */
export const applyShellWorkspaceAtom = atom(null, (get, set) => {
	const session = get(shellSessionAtom)
	if (!session || !session.isSessionReady()) return

	const currentShellDir = session.getCurrentDirectory()
	const currentWorkspaceDir = get(workspacePathAtom) || process.cwd()

	// Only apply changes if the shell directory is different from the current workspace
	if (currentShellDir !== currentWorkspaceDir) {
		try {
			// Change process cwd
			process.chdir(currentShellDir)

			// Update workspace path atom
			set(workspacePathAtom, currentShellDir)

			// Emit workspace change event (this will be handled by the CLI class)
			// The event emission will be handled by the UI component that subscribes to this atom
		} catch (_error) {
			// If chdir fails (e.g., directory doesn't exist in tests), just update the workspace path
			logs.warn(
				`Failed to change working directory to ${currentShellDir}, updating workspace path only`,
				"applyShellWorkspaceAtom",
			)
			set(workspacePathAtom, currentShellDir)
		}
	}
})

/**
 * Action atom to toggle shell mode
 * Only enters shell mode if input is empty, but always allows exiting
 */
export const toggleShellModeAtom = atom(null, (get, set) => {
	const isCurrentlyActive = get(shellModeActiveAtom)
	const isEmpty = get(textBufferIsEmptyAtom)

	if (!isCurrentlyActive) {
		// Entering shell mode - only allow if input is empty
		if (!isEmpty) {
			// Don't enter shell mode if there's already text in the input
			return
		}

		// Initialize shell session if needed (don't await to keep toggle synchronous)
		set(initializeShellSessionAtom)

		set(shellModeActiveAtom, true)
		set(inputModeAtom, "shell" as InputMode)
		set(shellHistoryIndexAtom, -1)
		// Clear text buffer when entering shell mode
		set(clearTextAtom)
	} else {
		// Exiting shell mode - always allow
		set(shellModeActiveAtom, false)
		set(inputModeAtom, "normal" as InputMode)
		set(shellHistoryIndexAtom, -1)
		// Clear text buffer when exiting shell mode
		set(clearTextAtom)

		// Apply shell workspace changes
		set(applyShellWorkspaceAtom)
	}
})

/**
 * Action atom to add command to shell history
 */
export const addToShellHistoryAtom = atom(null, (get, set, command: string) => {
	const history = get(shellHistoryAtom)
	const newHistory = [...history, command]
	// Keep only last 100 commands
	set(shellHistoryAtom, newHistory.slice(-100))
})

/**
 * Action atom to navigate shell history up
 */
export const navigateShellHistoryUpAtom = atom(null, (get, set) => {
	const history = get(shellHistoryAtom)
	const currentIndex = get(shellHistoryIndexAtom)

	if (history.length === 0) return

	let newIndex: number
	if (currentIndex === -1) {
		// First time going up - go to most recent command
		newIndex = history.length - 1
	} else if (currentIndex > 0) {
		// Go to older command
		newIndex = currentIndex - 1
	} else {
		// Already at oldest command
		return
	}

	set(shellHistoryIndexAtom, newIndex)

	// Set the text buffer to the history command
	set(setTextAtom, history[newIndex] || "")
})

/**
 * Action atom to navigate shell history down
 */
export const navigateShellHistoryDownAtom = atom(null, (get, set) => {
	const history = get(shellHistoryAtom)
	const currentIndex = get(shellHistoryIndexAtom)

	if (currentIndex === -1) return

	let newIndex: number
	if (currentIndex === history.length - 1) {
		// At most recent command - clear input
		newIndex = -1
	} else {
		// Go to newer command
		newIndex = currentIndex + 1
	}

	set(shellHistoryIndexAtom, newIndex)

	// Set the text buffer to the history command or clear it
	if (newIndex === -1) {
		set(clearTextAtom)
	} else {
		set(setTextAtom, history[newIndex] || "")
	}
})

/**
 * Action atom to execute shell command
 */
export const executeShellCommandAtom = atom(null, async (get, set, command: string) => {
	if (!command.trim()) return

	// Add to history
	set(addToShellHistoryAtom, command.trim())

	// Clear the text buffer immediately for better UX
	set(clearTextAtom)

	// Execute the command using the persistent shell session
	try {
		let session = get(shellSessionAtom)

		// Initialize session if it doesn't exist
		if (!session) {
			await set(initializeShellSessionAtom)
			session = get(shellSessionAtom)
		}

		if (!session || !session.isSessionReady()) {
			throw new Error("Shell session not ready")
		}

		// Execute command
		const result = await session.run(command)

		// Update current shell directory atom
		set(currentShellDirectoryAtom, result.cwd)

		// Prepare output message
		let output = ""
		if (result.stdout) output += result.stdout
		if (result.stderr) output += (output ? "\n" : "") + result.stderr
		if (!output) output = "Command executed successfully"

		// Display as system message for visibility in CLI
		const systemMessage = {
			id: `shell-${Date.now()}`,
			type: "system" as const,
			ts: Date.now(),
			content: `$ ${command}\n${output}`,
			partial: false,
		}

		set(addMessageAtom, systemMessage)
	} catch (error: unknown) {
		// Handle errors and display them in the message system
		const errorOutput = `❌ Error: ${error instanceof Error ? error.message : error}`

		// Display as error message for visibility in CLI
		const errorMessage = {
			id: `shell-error-${Date.now()}`,
			type: "error" as const,
			ts: Date.now(),
			content: `$ ${command}\n${errorOutput}`,
			partial: false,
		}

		set(addMessageAtom, errorMessage)
	}

	// Reset history navigation index
	set(shellHistoryIndexAtom, -1)
})
