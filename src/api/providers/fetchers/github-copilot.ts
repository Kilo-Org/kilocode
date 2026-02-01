// kilocode_change - new file
import type { ModelRecord } from "@roo-code/types"

import { githubCopilotModels } from "@roo-code/types"

import { fetchCopilotToken, resolveGitHubCopilotToken } from "../utils/github-copilot-auth"

const GITHUB_COPILOT_MODELS_URLS = [
	"https://api.githubcopilot.com/models",
	"https://api.githubcopilot.com/v1/models",
] as const
const COPILOT_USER_AGENT = process.env.KILOCODE_COPILOT_USER_AGENT ?? "KiloCode/1.0"
const COPILOT_EDITOR_VERSION = process.env.KILOCODE_COPILOT_EDITOR_VERSION ?? "KiloCode/1.0"
const COPILOT_EDITOR_PLUGIN_VERSION = process.env.KILOCODE_COPILOT_EDITOR_PLUGIN_VERSION ?? "KiloCode/1.0"
const COPILOT_INTEGRATION_ID = process.env.KILOCODE_COPILOT_INTEGRATION_ID ?? "vscode-chat"
const COPILOT_INITIATOR = process.env.KILOCODE_COPILOT_INITIATOR
const COPILOT_API_HEADERS: Record<string, string> = {
	Accept: "application/json",
	"Openai-Intent": "conversation-edits",
	"User-Agent": COPILOT_USER_AGENT,
	"Editor-Version": COPILOT_EDITOR_VERSION,
	"Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
	"Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
}
if (COPILOT_INITIATOR) {
	COPILOT_API_HEADERS["x-initiator"] = COPILOT_INITIATOR
}
const DEBUG_COPILOT_MODELS =
	process.env.KILOCODE_DEBUG_COPILOT_MODELS === "1" || process.env.KILOCODE_DEBUG_COPILOT_MODELS === "true"

interface CopilotModel {
	id: string
	object: string
	created: number
	owned_by: string | null
}

interface CopilotModelsResponse {
	data: CopilotModel[]
}

/**
 * Fetch available models from GitHub Copilot API
 */
export async function getGitHubCopilotModels(apiKey?: string): Promise<ModelRecord> {
	const resolvedToken = resolveGitHubCopilotToken(apiKey)
	if (!resolvedToken) {
		return {}
	}

	let token: string
	try {
		;({ token } = await fetchCopilotToken(resolvedToken))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.warn("[GitHubCopilotModels] Copilot token exchange failed, using static models:", message)
		return { ...githubCopilotModels }
	}
	let lastError: Error | undefined
	let data: CopilotModelsResponse | undefined

	for (const url of GITHUB_COPILOT_MODELS_URLS) {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				...COPILOT_API_HEADERS,
			},
		})

		if (!response.ok) {
			// 404 indicates the endpoint is not available; try the next URL.
			if (response.status === 404) {
				lastError = new Error(`GitHub Copilot models endpoint not found: ${url}`)
				continue
			}

			const errorText = await response.text().catch(() => "")
			const detail = errorText ? `: ${errorText}` : ""
			lastError = new Error(`Failed to fetch GitHub Copilot models (${url}): ${response.status}${detail}`)
			// For auth errors, don't fall back to static list.
			if (response.status === 401 || response.status === 403) {
				throw lastError
			}

			continue
		}

		data = (await response.json()) as CopilotModelsResponse
		if (DEBUG_COPILOT_MODELS) {
			const ids = data.data?.map((model) => model.id) ?? []
			console.info(`[GitHubCopilotModels] Raw models (${ids.length}): ${ids.join(", ")}`)
		}
		break
	}

	if (!data) {
		if (lastError) {
			console.warn("[GitHubCopilotModels] Falling back to static model list:", lastError.message)
		}
		return { ...githubCopilotModels }
	}

	const models: ModelRecord = {}
	const seen = new Set<string>()

	for (const model of data.data) {
		// Skip duplicates and embedding models
		if (seen.has(model.id) || model.id.includes("embedding")) {
			continue
		}
		seen.add(model.id)

		const staticInfo = (githubCopilotModels as ModelRecord)[model.id]
		if (staticInfo) {
			models[model.id] = { ...staticInfo }
			continue
		}

		// Determine model capabilities based on name
		const isClaudeModel = model.id.includes("claude")
		const isGptModel = model.id.includes("gpt")

		models[model.id] = {
			contextWindow: isClaudeModel ? 200_000 : isGptModel ? 128_000 : 32_000,
			supportsPromptCache: false,
			supportsImages: isClaudeModel || model.id.includes("4o") || model.id.includes("4.1"),
			supportsNativeTools: true,
			description: `${model.id} via GitHub Copilot`,
		}
	}

	return models
}
