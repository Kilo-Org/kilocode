import { spawn } from "child_process"

/**
 * Model information returned from CLI models command
 */
export interface AvailableModel {
	id: string
	displayName: string | null
	contextWindow: number
	supportsImages?: boolean
	inputPrice?: number
	outputPrice?: number
}

/**
 * Response from `kilocode models --json` command
 */
export interface ModelsApiResponse {
	provider: string
	currentModel: string
	models: AvailableModel[]
}

/**
 * Error response from CLI models command
 */
interface ModelsApiError {
	error: string
	code: string
}

/** Default timeout for fetching models (10 seconds) */
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Parse the output from `kilocode models --json` command.
 * Returns null if parsing fails or required fields are missing.
 */
export function parseModelsOutput(stdout: string): ModelsApiResponse | null {
	if (!stdout.trim()) {
		return null
	}

	try {
		const parsed = JSON.parse(stdout)

		// Check for error response
		if ("error" in parsed && "code" in parsed) {
			return null
		}

		// Validate required fields
		if (
			typeof parsed.provider !== "string" ||
			typeof parsed.currentModel !== "string" ||
			!Array.isArray(parsed.models)
		) {
			return null
		}

		// Validate models array
		for (const model of parsed.models) {
			if (typeof model.id !== "string" || typeof model.contextWindow !== "number") {
				return null
			}
		}

		return {
			provider: parsed.provider,
			currentModel: parsed.currentModel,
			models: parsed.models.map((m: Record<string, unknown>) => ({
				id: m.id as string,
				displayName: m.displayName as string | null,
				contextWindow: m.contextWindow as number,
				...(m.supportsImages !== undefined && { supportsImages: m.supportsImages as boolean }),
				...(m.inputPrice !== undefined && { inputPrice: m.inputPrice as number }),
				...(m.outputPrice !== undefined && { outputPrice: m.outputPrice as number }),
			})),
		}
	} catch {
		return null
	}
}

/**
 * Fetch available models from the CLI using `kilocode models --json`.
 *
 * @param cliPath - Path to the kilocode CLI executable
 * @param log - Logging function for errors and warnings
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 * @returns ModelsApiResponse on success, null on error
 */
export async function fetchAvailableModels(
	cliPath: string,
	log: (message: string) => void,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ModelsApiResponse | null> {
	return new Promise((resolve) => {
		let stdout = ""
		let stderr = ""
		let resolved = false
		let timeoutId: NodeJS.Timeout | undefined

		const cleanup = () => {
			if (timeoutId) {
				clearTimeout(timeoutId)
			}
		}

		const doResolve = (result: ModelsApiResponse | null) => {
			if (resolved) {
				return
			}
			resolved = true
			cleanup()
			resolve(result)
		}

		// Spawn CLI process
		const proc = spawn(cliPath, ["models", "--json"], {
			stdio: ["ignore", "pipe", "pipe"],
			timeout: timeoutMs,
		})

		// Set up timeout
		timeoutId = setTimeout(() => {
			log(`[CliModelsFetcher] Command timed out after ${timeoutMs}ms`)
			proc.kill()
			doResolve(null)
		}, timeoutMs)

		// Collect stdout
		proc.stdout?.on("data", (chunk) => {
			stdout += chunk.toString()
		})

		// Collect stderr
		proc.stderr?.on("data", (chunk) => {
			stderr += chunk.toString()
		})

		// Handle spawn error
		proc.on("error", (error) => {
			log(`[CliModelsFetcher] CLI spawn error: ${error.message}`)
			doResolve(null)
		})

		// Handle process close
		proc.on("close", (code) => {
			if (code !== 0) {
				log(`[CliModelsFetcher] CLI models command failed with code ${code}: ${stderr || "(no stderr)"}`)
				doResolve(null)
				return
			}

			const result = parseModelsOutput(stdout)
			if (!result) {
				log(`[CliModelsFetcher] Failed to parse CLI models output: ${stdout.slice(0, 200)}`)
			}
			doResolve(result)
		})
	})
}
