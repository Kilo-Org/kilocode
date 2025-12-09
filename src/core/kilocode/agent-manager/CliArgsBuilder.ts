export interface BuildCliArgsOptions {
	parallelMode?: boolean
	sessionId?: string
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// Always use --json-io for Agent Manager (enables stdin for bidirectional communication)
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	const args = ["--json-io", `--workspace=${workspace}`]

	if (options?.parallelMode) {
		args.push("--parallel")
	}

	if (options?.sessionId) {
		args.push(`--session=${options.sessionId}`)
	}

	args.push(prompt)
	return args
}
