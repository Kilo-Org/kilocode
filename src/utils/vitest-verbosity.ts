// kilocode_change start
export function resolveVerbosity(argv = process.argv, env = process.env) {
	// Check if running in CI environment
	const isCI = env.CI === "true" || env.CI === "1" || Boolean(env.CI)

	// Check if --no-silent flag is used (native vitest flag)
	const cliNoSilent = argv.includes("--no-silent") || argv.includes("--silent=false")
	const silent = !cliNoSilent && !isCI // Silent by default, but not in CI

	// Check if verbose reporter is requested
	const wantsVerboseReporter = argv.some(
		(a) => a === "--reporter=verbose" || a === "-r=verbose" || a === "--reporter",
	)

	// Use verbose reporter in CI or when explicitly requested
	const useVerboseReporter = isCI || wantsVerboseReporter

	return {
		silent,
		reporters: useVerboseReporter ? ["verbose"] : ["dot"],
		onConsoleLog: (_log: string, type: string) => {
			// When verbose, show everything
			// When silent, allow errors/warnings and drop info/log/warn noise
			if (!silent || type === "stderr") return

			return false // Drop info/log/warn noise
		},
	}
}
// kilocode_change end
