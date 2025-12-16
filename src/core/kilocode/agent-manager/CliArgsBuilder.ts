export interface BuildCliArgsOptions {
	parallelMode?: boolean
	sessionId?: string
	yoloMode?: boolean
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// --json-io: enables bidirectional JSON communication via stdin/stdout
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	const args = ["--json-io", `--workspace=${workspace}`]

	// --yolo: auto-approve all tool permissions (file writes, command execution, etc.)
	// Only enable when explicitly requested - default is interactive mode
	if (options?.yoloMode) {
		args.push("--yolo")
	}

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
