export interface BuildCliArgsOptions {
	sessionId?: string
	/**
	 * When true (default), adds --yolo flag to auto-approve all tool operations.
	 * When false, CLI will send ask messages requiring user approval via JSON-IO.
	 */
	yoloMode?: boolean
	/** Model ID to use for this session (overrides CLI default) */
	model?: string
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 * Runs in interactive mode - approvals are handled via the JSON-IO protocol.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// --json-io: enables bidirectional JSON communication via stdin/stdout
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	const args = ["--json-io"]

	// --yolo: auto-approve tool uses (file reads, writes, commands, etc.)
	// Default to true for backward compatibility - only omit when explicitly false
	if (options?.yoloMode !== false) {
		args.push("--yolo")
	}

	args.push(`--workspace=${workspace}`)

	if (options?.model) {
		args.push(`--model=${options.model}`)
	}

	if (options?.sessionId) {
		args.push(`--session=${options.sessionId}`)
	}

	// Only add prompt if non-empty
	// When resuming with --session, an empty prompt means "continue from where we left off"
	if (prompt) {
		args.push(prompt)
	}

	return args
}
