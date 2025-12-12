import type { ProviderSettings } from "@roo-code/types"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type EnvOverrides = Record<string, string>

const hasNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

type CliConfigShape = {
	provider?: unknown
	providers?: unknown
}

type CliProviderShape = {
	id?: unknown
	provider?: unknown
}

const getHomeDirFromEnv = (baseEnv: NodeJS.ProcessEnv): string | undefined =>
	baseEnv.HOME || baseEnv.USERPROFILE || baseEnv.HOMEPATH

const getCliConfigPath = (baseEnv: NodeJS.ProcessEnv): string => {
	const homeDir = getHomeDirFromEnv(baseEnv) || os.homedir()
	return path.join(homeDir, ".kilocode", "cli", "config.json")
}

const readCliConfig = (filePath: string): CliConfigShape | undefined => {
	try {
		const raw = fs.readFileSync(filePath, "utf8")
		return JSON.parse(raw) as CliConfigShape
	} catch {
		return undefined
	}
}

const findKilocodeProviderId = (config: CliConfigShape | undefined): string | undefined => {
	const providers = Array.isArray(config?.providers) ? (config!.providers as unknown[]) : []
	const kiloProviders = providers.filter((p): p is CliProviderShape => {
		const provider = (p as CliProviderShape | undefined)?.provider
		const id = (p as CliProviderShape | undefined)?.id
		return provider === "kilocode" && hasNonEmptyString(id)
	})

	if (kiloProviders.length === 0) {
		return undefined
	}

	const defaultKilo = kiloProviders.find((p) => p.id === "default")
	return (defaultKilo?.id as string | undefined) ?? (kiloProviders[0]!.id as string)
}

const getTempDirFromEnv = (baseEnv: NodeJS.ProcessEnv): string =>
	baseEnv.TMPDIR || baseEnv.TEMP || baseEnv.TMP || os.tmpdir()

/**
 * Inject IDE Kilocode authentication into Agent Manager CLI spawns.
 *
 * Design choice: we only inject Kilocode auth (not BYOK providers) to avoid
 * maintaining provider-specific env mappings here.
 *
 * Behavior:
 * - If the IDE's active provider is `kilocode` and a token exists, we inject:
 *   - `KILOCODE_TOKEN` (required)
 *   - `KILOCODE_ORGANIZATION_ID` (optional)
 *
 * Provider selection strategy (important for older CLIs):
 * - If the user's CLI config contains a `kilocode` provider entry, we set `KILO_PROVIDER`
 *   to that provider id so the CLI switches to it without changing other CLI settings.
 * - If no `kilocode` provider exists in CLI config, we fall back to env-config mode by
 *   setting `KILO_PROVIDER_TYPE=kilocode` and required vars. To ensure the CLI uses env
 *   config even when a config file exists, we override `HOME` to a temporary directory.
 * - If missing/partial, we log and return `{}` so the CLI runs unchanged.
 */
export const buildProviderEnvOverrides = (
	apiConfiguration: ProviderSettings | undefined,
	baseEnv: NodeJS.ProcessEnv,
	log: (message: string) => void,
	debugLog: (message: string) => void,
): EnvOverrides => {
	if (!apiConfiguration) {
		debugLog("[AgentManager] No apiConfiguration found; using existing environment.")
		return {}
	}

	if (!apiConfiguration.apiProvider) {
		log("[AgentManager] apiConfiguration missing provider; skipping CLI env injection.")
		return {}
	}

	if (apiConfiguration.apiProvider !== "kilocode") {
		debugLog(`[AgentManager] Provider "${apiConfiguration.apiProvider}" not eligible for env injection; skipping.`)
		return {}
	}

	if (!hasNonEmptyString(apiConfiguration.kilocodeToken)) {
		log("[AgentManager] Missing Kilocode token in apiConfiguration; skipping CLI auth injection.")
		return {}
	}

	const overrides: EnvOverrides = {}

	// Prefer switching to an existing Kilocode provider entry in the user's CLI config
	// (preserves other CLI settings like auto-approval and themes).
	const cliConfigPath = getCliConfigPath(baseEnv)
	const hasCliConfigFile = fs.existsSync(cliConfigPath)

	const cliConfig = hasCliConfigFile ? readCliConfig(cliConfigPath) : undefined
	const kilocodeProviderId = findKilocodeProviderId(cliConfig)

	if (kilocodeProviderId) {
		overrides.KILO_PROVIDER = kilocodeProviderId
		overrides.KILOCODE_TOKEN = apiConfiguration.kilocodeToken
	} else {
		// Fallback: env-config mode requires model id as well.
		if (!hasNonEmptyString(apiConfiguration.kilocodeModel)) {
			log("[AgentManager] Missing Kilocode model in apiConfiguration; skipping CLI auth injection.")
			return {}
		}

		overrides.KILO_PROVIDER = "default"
		overrides.KILO_PROVIDER_TYPE = "kilocode"
		overrides.KILOCODE_TOKEN = apiConfiguration.kilocodeToken
		overrides.KILOCODE_MODEL = apiConfiguration.kilocodeModel

		// Older CLIs will only honor env-config when no config file exists. If a user has configured
		// another provider in the CLI, we override HOME so the CLI doesn't see their existing config.
		if (hasCliConfigFile) {
			const tempDir = getTempDirFromEnv(baseEnv)
			const isolatedHome = path.join(tempDir, "kilocode-agent-manager-home")
			// Cross-platform: Node's os.homedir() uses USERPROFILE on Windows.
			overrides.HOME = isolatedHome
			overrides.USERPROFILE = isolatedHome
		}
	}

	if (hasNonEmptyString(apiConfiguration.kilocodeOrganizationId)) {
		overrides.KILOCODE_ORGANIZATION_ID = apiConfiguration.kilocodeOrganizationId
	}

	const appliedKeys = Object.keys(overrides).filter((key) => key !== "KILOCODE_TOKEN")
	debugLog(`[AgentManager] Injecting Kilocode CLI auth env (keys: ${appliedKeys.join(", ")})`)

	return overrides
}
