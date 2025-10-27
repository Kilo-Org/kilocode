import { SECRET_STATE_KEYS, GLOBAL_SECRET_KEYS, ProviderSettings } from "@roo-code/types"

export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config) {
		return false
	}

	// Special case for providers which don't need configuration to exit onboarding.
	// Add 'oca' so selecting Oracle Code Assist exits Welcome flow immediately (login happens in Settings).
	if (
		config.apiProvider &&
		["human-relay", "fake-ai", "claude-code", "qwen-code", "roo", "gemini-cli", "oca"].includes(config.apiProvider)
	) {
		return true
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	// Filter out keys that are not part of ProviderSettings (global secrets are stored separately)
	const providerSecretKeys = SECRET_STATE_KEYS.filter((key) => !GLOBAL_SECRET_KEYS.includes(key as any))
	const hasSecretKey = providerSecretKeys.some((key) => config[key as keyof ProviderSettings] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
		config.kilocodeModel, // kilocode_change
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}
