export interface BuildCliArgsOptions {
	parallelMode?: boolean
}

/**
 * Builds CLI arguments for spawning kilocode agent processes
 */
export function buildCliArgs(workspace: string, prompt: string, options?: BuildCliArgsOptions): string[] {
	const args = ["--auto", "--json", `--workspace=${workspace}`]
	if (options?.parallelMode) {
		args.push("--parallel")
	}
	args.push(prompt)
	return args
}
