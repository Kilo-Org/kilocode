export interface BuildCliArgsOptions {
	parallelMode?: boolean
	sessionId?: string
	autoMode?: boolean
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// Always use --json-io for Agent Manager (enables stdin for bidirectional communication)
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	const args = ["--json-io", `--workspace=${workspace}`]

	if (options?.autoMode) {
		args.push("--auto")
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
