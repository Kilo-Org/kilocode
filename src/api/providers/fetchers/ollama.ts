import axios from "axios"
import { ModelInfo, ollamaDefaultModelInfo } from "@roo-code/types"
import { z } from "zod"

const OllamaModelDetailsSchema = z.object({
	family: z.string(),
	families: z.array(z.string()).nullable().optional(),
	format: z.string().optional(),
	parameter_size: z.string(),
	parent_model: z.string().optional(),
	quantization_level: z.string().optional(),
})

const OllamaModelSchema = z.object({
	details: OllamaModelDetailsSchema,
	digest: z.string().optional(),
	model: z.string(),
	modified_at: z.string().optional(),
	name: z.string(),
	size: z.number().optional(),
})

const OllamaModelInfoResponseSchema = z.object({
	modelfile: z.string().optional(),
	parameters: z.string().optional(),
	template: z.string().optional(),
	details: OllamaModelDetailsSchema,
	model_info: z.record(z.string(), z.any()),
	capabilities: z.array(z.string()).optional(),
})

const OllamaModelsResponseSchema = z.object({
	models: z.array(OllamaModelSchema),
})

type OllamaModelsResponse = z.infer<typeof OllamaModelsResponseSchema>

type OllamaModelInfoResponse = z.infer<typeof OllamaModelInfoResponseSchema>

function parseOllamaParametersToJSON(inputString: string): Record<string, any> {
	const lines = inputString.split("\n")
	const result: Record<string, any> = {}

	lines.forEach((line) => {
		const parts = line.trim().split(/\s+/) // Split by one or more spaces
		let key = parts[0]
		let value = parts.slice(1).join(" ") // Re-join the rest as the value

		// Remove quotes from value if present
		if (value.startsWith('"') && value.endsWith('"')) {
			value = value.substring(1, value.length - 1)
		}

		// Type conversion
		let parsedValue: any
		if (!isNaN(Number(value))) {
			parsedValue = Number(value) // Try to parse as number
		} else if (value.toLowerCase() === "true") {
			parsedValue = true
		} else if (value.toLowerCase() === "false") {
			parsedValue = false
		} else {
			parsedValue = value // Keep as string
		}

		// Handle duplicate 'stop' keys by collecting them into an array
		if (key === "stop") {
			if (!result[key]) {
				result[key] = []
			}
			;(result[key] as string[]).push(parsedValue)
		} else {
			result[key] = parsedValue
		}
	})

	return result
}

export const parseOllamaModel = (rawModel: OllamaModelInfoResponse): ModelInfo => {
	// kilocode_change start

	const parameters = rawModel.parameters ? parseOllamaParametersToJSON(rawModel.parameters) : undefined
	const contextLengthFromModelParameters = parameters ? parseInt(parameters.num_ctx, 10) : undefined
	let definedContextWindow = contextLengthFromModelParameters

	// Find the first key that ends with the ".context_length" suffix.
	const modelInfoKeys = Object.keys(rawModel.model_info)
	const contextLengthKey = modelInfoKeys.find((key) => key.endsWith(".context_length"))
	// If a matching key was found, extract its value.
	if (contextLengthKey) {
		definedContextWindow = rawModel.model_info[contextLengthKey]
	} // This enables us to grab qwen3.context_length or qwen2.context_length or gemma3.context_length, etc.

	if (process.env.OLLAMA_CONTEXT_LENGTH && parseInt(process.env.OLLAMA_CONTEXT_LENGTH, 10)) {
		definedContextWindow = parseInt(process.env.OLLAMA_CONTEXT_LENGTH, 10)
		// env var overrides all.
	}

	const modelInfo: ModelInfo = Object.assign({}, ollamaDefaultModelInfo, {
		description: `Family: ${rawModel.details.family}, Context: ${definedContextWindow || ollamaDefaultModelInfo.contextWindow}, Size: ${rawModel.details.parameter_size}`,
		contextWindow: definedContextWindow || ollamaDefaultModelInfo.contextWindow,
		supportsPromptCache: true,
		supportsImages: rawModel.capabilities?.includes("vision"),
		supportsComputerUse: false,
		maxTokens: definedContextWindow || ollamaDefaultModelInfo.contextWindow,
	})
	// grab the specified context window from what ollama tells us about the paramaters.
	// If thats not defined, grab it from environment overrides.
	// If thats not defined, use whatever the model defaults are.
	// If thats not defined, use ollamaDefaultModelInfo.contextWindow
	// kilocode_change end

	return modelInfo
}

export async function getOllamaModels(baseUrl = "http://localhost:11434"): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	// clearing the input can leave an empty string; use the default in that case
	baseUrl = baseUrl === "" ? "http://localhost:11434" : baseUrl

	try {
		if (!URL.canParse(baseUrl)) {
			return models
		}

		const response = await axios.get<OllamaModelsResponse>(`${baseUrl}/api/tags`)
		const parsedResponse = OllamaModelsResponseSchema.safeParse(response.data)
		let modelInfoPromises = []

		if (parsedResponse.success) {
			for (const ollamaModel of parsedResponse.data.models) {
				modelInfoPromises.push(
					axios
						.post<OllamaModelInfoResponse>(`${baseUrl}/api/show`, {
							model: ollamaModel.model,
						})
						.then((ollamaModelInfo) => {
							models[ollamaModel.name] = parseOllamaModel(ollamaModelInfo.data)
						}),
				)
			}

			await Promise.all(modelInfoPromises)
		} else {
			console.error(`Error parsing Ollama models response: ${JSON.stringify(parsedResponse.error, null, 2)}`)
		}
	} catch (error) {
		if (error.code === "ECONNREFUSED") {
			console.warn(`Failed connecting to Ollama at ${baseUrl}`)
		} else {
			console.error(
				`Error fetching Ollama models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)
		}
	}

	return models
}
