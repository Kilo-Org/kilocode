/**
 * Providers API command - Exposes configured providers as JSON for programmatic use
 *
 * Usage:
 *   kilocode providers [list]
 *
 * Output format:
 *   {
 *     "current": "kilocode-1",
 *     "providers": [
 *       {
 *         "id": "kilocode-1",
 *         "type": "kilocode",
 *         "label": "Kilo Code",
 *         "model": "claude-sonnet-4",
 *         "isCurrent": true
 *       }
 *     ]
 *   }
 */

import { createStore } from "jotai"
import { loadConfigAtom } from "../state/atoms/config.js"
import { logs } from "../services/logs.js"
import { getProviderLabel } from "../constants/providers/labels.js"
import { getModelIdForProvider } from "../config/mapper.js"
import type { CLIConfig } from "../config/types.js"

/**
 * Output format for the providers API command
 */
export interface ProvidersApiOutput {
	current: string | null
	providers: Array<{
		id: string
		type: string
		label: string
		model: string | null
		isCurrent: boolean
	}>
}

/**
 * Error output format
 */
export interface ProvidersApiError {
	error: string
	code: string
}

function normalizeModelId(modelId: string): string | null {
	return modelId === "" ? null : modelId
}

export function buildProvidersOutput(config: CLIConfig): ProvidersApiOutput {
	const currentProvider = config.providers.find((provider) => provider.id === config.provider) || null

	return {
		current: currentProvider?.id ?? null,
		providers: config.providers.map((provider) => {
			const modelId = getModelIdForProvider(provider)
			return {
				id: provider.id,
				type: provider.provider,
				label: getProviderLabel(provider.provider),
				model: normalizeModelId(modelId),
				isCurrent: provider.id === currentProvider?.id,
			}
		}),
	}
}

/**
 * Output result as JSON to stdout
 */
function outputJson(data: ProvidersApiOutput | ProvidersApiError): void {
	console.log(JSON.stringify(data, null, 2))
}

/**
 * Output error and exit
 */
function outputError(message: string, code: string): never {
	outputJson({ error: message, code })
	process.exit(1)
}

/**
 * Main providers API command handler
 */
export async function providersApiCommand(): Promise<void> {
	try {
		logs.info("Starting providers API command", "ProvidersAPI")

		const store = createStore()
		const config = await store.set(loadConfigAtom)

		const output = buildProvidersOutput(config)
		outputJson(output)

		logs.info("Providers API command completed successfully", "ProvidersAPI", {
			providerCount: output.providers.length,
		})
	} catch (error) {
		logs.error("Providers API command failed", "ProvidersAPI", { error })
		outputError(error instanceof Error ? error.message : "An unexpected error occurred", "INTERNAL_ERROR")
	}

	process.exit(0)
}
