/**
 * Utilities for detecting interactive vs non-interactive mode
 * Used to prevent blocking on user input in CI/automated environments
 */

/**
 * Common CI environment variables that indicate a non-interactive environment
 */
const CI_ENV_VARS = [
	"CI", // Generic CI (GitHub Actions, GitLab CI, etc.)
	"GITHUB_ACTIONS", // GitHub Actions
	"GITLAB_CI", // GitLab CI
	"JENKINS_URL", // Jenkins
	"CIRCLECI", // CircleCI
	"TRAVIS", // Travis CI
	"BUILDKITE", // Buildkite
	"CODEBUILD_BUILD_ID", // AWS CodeBuild
	"TF_BUILD", // Azure Pipelines
	"TEAMCITY_VERSION", // TeamCity
] as const

/**
 * Options that can indicate non-interactive mode
 */
export interface NonInteractiveOptions {
	auto?: boolean
	json?: boolean
	jsonIo?: boolean
}

/**
 * Check if running in a CI environment based on environment variables
 */
export function isCI(): boolean {
	return CI_ENV_VARS.some((envVar) => {
		const value = process.env[envVar]
		// Check if the variable exists and is truthy (not empty, not "false"/"FALSE", not "0")
		if (value === undefined || value === "") {
			return false
		}
		const lowerValue = value.toLowerCase()
		return lowerValue !== "false" && lowerValue !== "0"
	})
}

/**
 * Check if stdin is connected to an interactive terminal (TTY)
 */
export function isStdinTTY(): boolean {
	return process.stdin.isTTY === true
}

/**
 * Determine if the CLI is running in a non-interactive mode
 *
 * Non-interactive mode is detected when any of the following is true:
 * - --auto flag is set
 * - --json flag is set (implies non-interactive output)
 * - --json-io flag is set (bidirectional JSON mode)
 * - stdin is not a TTY (e.g., piped input)
 * - Running in a CI environment
 *
 * @param options - CLI options that can force non-interactive mode
 * @returns true if running in non-interactive mode
 */
export function isNonInteractiveMode(options: NonInteractiveOptions = {}): boolean {
	// Explicit flags that indicate non-interactive mode
	if (options.auto || options.json || options.jsonIo) {
		return true
	}

	// stdin not connected to terminal
	if (!isStdinTTY()) {
		return true
	}

	// CI environment detected
	if (isCI()) {
		return true
	}

	return false
}

/**
 * Get a detailed reason why non-interactive mode was detected
 * Useful for debugging and error messages
 *
 * @param options - CLI options to check
 * @returns Human-readable reason string or null if interactive
 */
export function getNonInteractiveReason(options: NonInteractiveOptions = {}): string | null {
	if (options.auto) {
		return "--auto flag is set"
	}
	if (options.json) {
		return "--json flag is set"
	}
	if (options.jsonIo) {
		return "--json-io flag is set"
	}
	if (!isStdinTTY()) {
		return "stdin is not a TTY (input may be piped)"
	}
	if (isCI()) {
		const detectedVar = CI_ENV_VARS.find((v) => {
			const val = process.env[v]
			if (val === undefined || val === "") {
				return false
			}
			const lowerVal = val.toLowerCase()
			return lowerVal !== "false" && lowerVal !== "0"
		})
		// Only output variable name, not value (may contain sensitive tokens)
		return `CI environment detected (${detectedVar} is set)`
	}
	return null
}

/**
 * Generate a helpful error message for when auth is required in non-interactive mode
 *
 * @param reason - The reason non-interactive mode was detected
 * @returns Formatted error message with configuration instructions
 */
export function getConfigRequiredError(reason: string | null): string {
	const lines = [
		"Error: No configuration found and cannot run authentication wizard.",
		"",
		`Reason: ${reason || "Running in non-interactive mode"}`,
		"",
		"To use Kilo Code CLI in non-interactive/CI mode, you must configure it first.",
		"",
		"Option 1: Set environment variables (recommended for CI)",
		"  export KILO_PROVIDER_TYPE=anthropic",
		"  export KILO_API_KEY=your-api-key",
		"  export KILO_API_MODEL_ID=your-model-id",
		"",
		"Option 2: Run the auth wizard interactively first",
		"  kilocode auth",
		"",
		"Option 3: Use a config file",
		"  Provide a config file at ~/.kilocode/cli/config.json",
		"",
		"For more details, see:",
		"  https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/ENVIRONMENT_VARIABLES.md",
	]

	return lines.join("\n")
}

export interface ConfigRequiredErrorOutputOptions {
	json?: boolean
	jsonIo?: boolean
	reason: string | null
	stdout?: (message: string) => void
	stderr?: (message: string) => void
}

export function emitConfigRequiredError({
	json,
	jsonIo,
	reason,
	stdout = console.log,
	stderr = console.error,
}: ConfigRequiredErrorOutputOptions): void {
	const errorMessage = getConfigRequiredError(reason)

	if (json || jsonIo) {
		stdout(
			JSON.stringify({
				type: "error",
				error: "configuration_required",
				message: errorMessage,
				reason,
			}),
		)
		return
	}

	stderr(errorMessage)
}
