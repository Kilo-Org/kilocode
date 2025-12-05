/**
 * Builds CLI arguments for spawning kilocode agent processes
 */
export function buildCliArgs(workspace: string, prompt: string): string[] {
	return ["--auto", "--json", `--workspace=${workspace}`, prompt]
}
