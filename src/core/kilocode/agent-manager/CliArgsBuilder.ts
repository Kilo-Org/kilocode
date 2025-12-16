export interface BuildCliArgsOptions {
	parallelMode?: boolean
	sessionId?: string
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 * Uses --auto to auto-approve tool operations (commands, file writes, etc.)
 * so Agent Manager can operate autonomously without manual approval UI.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// --json-io: enables bidirectional JSON communication via stdin/stdout
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	const args = ["--json-io", `--workspace=${workspace}`]

	// --auto: auto-approve tool operations (file writes, command execution, etc.)
	// Required for Agent Manager since it doesn't have approval UI
	// Unlike --yolo, --auto does NOT auto-answer followup questions
	args.push("--auto")

	if (options?.parallelMode) {
		args.push("--parallel")
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
