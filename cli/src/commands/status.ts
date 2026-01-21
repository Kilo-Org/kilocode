import path from "node:path"
import simpleGit from "simple-git"
import { loadConfig, configExists, getConfigPath } from "../config/persistence.js"
import { applyEnvOverrides, envConfigExists, isEphemeralMode } from "../config/env-config.js"
import { validateConfig, validateProviderConfig } from "../config/validation.js"
import { KILOCODE_PREFIX, KILO_PREFIX, SPECIFIC_ENV_VARS } from "../config/env-utils.js"
import { getModelIdForProvider } from "../config/mapper.js"
import type { CLIConfig, ProviderConfig } from "../config/types.js"
import { DEFAULT_CONFIG } from "../config/defaults.js"
import { getGitInfo } from "../utils/git.js"

const overrideOrder = ["mode", "provider", "model", "theme", "telemetry"] as const
type OverrideField = (typeof overrideOrder)[number]

export const STATUS_SOURCE = {
	ENV: "env",
	GLOBAL_FILE: "globalFile",
	DEFAULT: "default",
} as const

export type StatusSource = (typeof STATUS_SOURCE)[keyof typeof STATUS_SOURCE]

export interface StatusReport {
	mode: string
	provider: {
		id: string
		type: string
		model: string | null
	}
	workspace: {
		path: string
		repo: string | null
		branch: string | null
	}
	theme: string
	telemetry: boolean
	config: {
		source: StatusSource
		path: string
		exists: boolean
	}
	env: {
		providerTypeSet: boolean
		ephemeralMode: boolean
		overridesActive: boolean
		overriddenFields: OverrideField[]
		providerVarsSetCount: number
	}
	auth: {
		configured: boolean
		reason: string
	}
	validation: {
		valid: boolean
		errors: string[]
	}
	source: {
		mode: StatusSource
		provider: StatusSource
		model: StatusSource
		theme: StatusSource
		telemetry: StatusSource
	}
}

export interface StatusOptions {
	json?: boolean
	workspace?: string
}

function resolveBaselineSource(configFileExists: boolean, envConfigPresent: boolean): StatusSource {
	if (envConfigPresent) {
		return STATUS_SOURCE.ENV
	}
	if (configFileExists) {
		return STATUS_SOURCE.GLOBAL_FILE
	}
	return STATUS_SOURCE.DEFAULT
}

function resolveProviderEnvVars(providerType: string): string[] {
	const entries = Object.entries(process.env)
	const vars: string[] = []

	if (providerType === "kilocode") {
		for (const [key, value] of entries) {
			if (key.startsWith(KILOCODE_PREFIX) && value) {
				vars.push(key)
			}
		}
	} else {
		for (const [key, value] of entries) {
			if (key.startsWith(KILO_PREFIX) && !SPECIFIC_ENV_VARS.has(key) && value) {
				vars.push(key)
			}
		}
	}

	return vars.sort()
}

function resolveFieldSource(hasEnvOverride: boolean, baseSource: StatusSource): StatusSource {
	return hasEnvOverride ? STATUS_SOURCE.ENV : baseSource
}

function resolveProvider(config: CLIConfig): ProviderConfig | null {
	if (!config.providers || config.providers.length === 0) {
		return null
	}

	const selected = config.providers.find((p) => p.id === config.provider)
	return selected || config.providers[0] || null
}

async function resolveWorkspaceInfo(workspacePath: string) {
	const resolvedPath = workspacePath || process.cwd()
	const gitInfo = await getGitInfo(resolvedPath)

	if (!gitInfo.isRepo) {
		return { path: resolvedPath, repo: null, branch: null }
	}

	let repoName: string | null = null
	try {
		const git = simpleGit(resolvedPath)
		const root = await git.revparse(["--show-toplevel"])
		repoName = root ? path.basename(root.trim()) : null
	} catch {
		repoName = path.basename(resolvedPath)
	}

	return {
		path: resolvedPath,
		repo: repoName,
		branch: gitInfo.branch,
	}
}

function buildAuthStatus(provider: ProviderConfig | null) {
	if (!provider) {
		return { configured: false, reason: "no provider configured" }
	}

	const validation = validateProviderConfig(provider, true)
	if (validation.valid) {
		return { configured: true, reason: "credential fields present for selected provider" }
	}

	return { configured: false, reason: "required fields missing for selected provider" }
}

function buildSourceMetadata(baseSource: StatusSource, baseConfig: CLIConfig, config: CLIConfig) {
	const baseProvider = resolveProvider(baseConfig)
	const currentProvider = resolveProvider(config)
	const baseModelId = baseProvider ? getModelIdForProvider(baseProvider) : ""
	const currentModelId = currentProvider ? getModelIdForProvider(currentProvider) : ""

	return {
		mode: resolveFieldSource(baseConfig.mode !== config.mode, baseSource),
		provider: resolveFieldSource(baseConfig.provider !== config.provider, baseSource),
		model: resolveFieldSource(baseModelId !== currentModelId, baseSource),
		theme: resolveFieldSource(baseConfig.theme !== config.theme, baseSource),
		telemetry: resolveFieldSource(baseConfig.telemetry !== config.telemetry, baseSource),
	}
}

export async function buildStatusReport(options: StatusOptions = {}): Promise<StatusReport> {
	const workspacePath = options.workspace || process.cwd()
	const configPath = getConfigPath()
	const configFileExists = await configExists()
	const envConfigPresent = envConfigExists()
	const baseSource = resolveBaselineSource(configFileExists, envConfigPresent)

	const UNKNOWN = "unknown"

	const loaded = await loadConfig()
	const baseConfig = loaded.config
	const config = applyEnvOverrides(baseConfig)

	const provider = resolveProvider(config)
	const providerType = provider?.provider || UNKNOWN
	const providerId = provider?.id || UNKNOWN
	const modelId = (provider ? getModelIdForProvider(provider) : null) || UNKNOWN
	const providerEnvVars = resolveProviderEnvVars(providerType)
	const workspace = await resolveWorkspaceInfo(workspacePath)
	const validation = await validateConfig(config)
	const auth = buildAuthStatus(provider)
	const source = buildSourceMetadata(baseSource, baseConfig, config)
	const overriddenFields = overrideOrder.filter((field) => source[field] === STATUS_SOURCE.ENV)

	return {
		mode: config.mode || UNKNOWN,
		provider: {
			id: providerId,
			type: providerType,
			model: modelId,
		},
		workspace,
		theme: config.theme || DEFAULT_CONFIG.theme,
		telemetry: Boolean(config.telemetry),
		config: {
			source: baseSource,
			path: configPath,
			exists: configFileExists,
		},
		env: {
			providerTypeSet: envConfigPresent,
			ephemeralMode: isEphemeralMode(),
			overridesActive: overriddenFields.length > 0,
			overriddenFields: [...overriddenFields],
			providerVarsSetCount: providerEnvVars.length,
		},
		auth,
		validation: {
			valid: validation.valid,
			errors: validation.errors || [],
		},
		source,
	}
}

function formatWorkspaceLabel(workspace: StatusReport["workspace"]): string {
	if (workspace.repo && workspace.branch) {
		return `${workspace.path} (repo: ${workspace.repo}, branch: ${workspace.branch})`
	}
	if (workspace.repo) {
		return `${workspace.path} (repo: ${workspace.repo})`
	}
	return workspace.path
}

export function formatStatusText(report: StatusReport): string {
	const modelLabel = report.provider.model || "not set"
	const validationLabel = report.validation.valid ? "ok 🟢" : `failed (${report.validation.errors.join("; ")}) 🔴`
	const overridesLabel =
		report.env.overriddenFields.length === 0
			? "Env overrides: inactive"
			: `Env overrides: active (${report.env.overriddenFields.join(", ")})`

	return [
		`Mode: ${report.mode}`,
		`Provider: ${report.provider.type} (id: ${report.provider.id})`,
		`Model: ${modelLabel}`,
		`Workspace: ${formatWorkspaceLabel(report.workspace)}`,
		`Theme: ${report.theme}`,
		`Telemetry: ${report.telemetry ? "enabled" : "disabled"}`,
		`Config: ${report.config.path} (${report.config.exists ? "exists" : "missing"})`,
		`Env: provider-type ${report.env.providerTypeSet ? "set" : "not set"}, ephemeral ${report.env.ephemeralMode ? "on" : "off"}`,
		overridesLabel,
		`Auth: ${report.auth.configured ? "configured" : "not configured"} (${report.auth.reason})`,
		`Validation: ${validationLabel}`,
		`Provider Env Vars: ${report.env.providerVarsSetCount} set (names omitted)`,
		"Sources:",
		`- Mode: ${report.source.mode}`,
		`- Provider: ${report.source.provider}`,
		`- Model: ${report.source.model}`,
		`- Theme: ${report.source.theme}`,
		`- Telemetry: ${report.source.telemetry}`,
		`- Config: ${report.config.source}`,
	].join("\n")
}

export function formatStatusJson(report: StatusReport): string {
	return JSON.stringify(report, null, 2)
}

export function resolveExitCode(report: StatusReport): number {
	if (!report.validation.valid) {
		return 1
	}
	return 0
}

export async function runStatusCommand(options: StatusOptions = {}): Promise<void> {
	try {
		const report = await buildStatusReport(options)
		const output = options.json ? formatStatusJson(report) : formatStatusText(report)

		console.log(output)
		process.exit(resolveExitCode(report))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`Error: ${message}`)
		process.exit(2)
	}
}
