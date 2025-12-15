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
	// Agent Manager runs agents in autonomous mode by default.
	// Always use --json-io (enables stdin for bidirectional communication).
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	// autoMode option is accepted for backwards compatibility but --auto is always included
	const args = ["--auto", "--json-io", `--workspace=${workspace}`]

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
