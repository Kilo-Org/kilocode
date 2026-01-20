export interface BuildCliArgsOptions {
	sessionId?: string
	model?: string
	/** When true, prompt will be sent via stdin (for multimodal messages with images) */
	promptViaStdin?: boolean
}

/**
 * Builds CLI arguments for spawning kilocode agent processes.
 * Uses --json-io for bidirectional communication via stdin/stdout.
 * Runs in interactive mode - approvals are handled via the JSON-IO protocol.
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	// --json-io: enables bidirectional JSON communication via stdin/stdout
	// Note: --json (without -io) exists for CI/CD read-only mode but isn't used here
	// --yolo: auto-approve tool uses (file reads, writes, commands, etc.)
	const args = ["--json-io", "--yolo", `--workspace=${workspace}`]

	if (options?.model) {
		args.push(`--model=${options.model}`)
	}

	if (options?.sessionId) {
		args.push(`--session=${options.sessionId}`)
	}

	// Only add prompt if non-empty and not being sent via stdin
	// When resuming with --session, an empty prompt means "continue from where we left off"
	// When promptViaStdin is true, prompt will be sent as a newTask message via stdin
	// (used for multimodal messages with images)
	if (prompt && !options?.promptViaStdin) {
		args.push(prompt)
	}

	return args
}
