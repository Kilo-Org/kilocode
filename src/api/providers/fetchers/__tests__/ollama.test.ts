import axios from "axios"

import { getOllamaModels, parseOllamaModel } from "../ollama"
import ollamaModelsData from "./fixtures/ollama-model-details.json"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

describe("Ollama Fetcher", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("parseOllamaModel", () => {
		it("should correctly parse Ollama model info", () => {
			const modelData = ollamaModelsData["qwen3-2to16:latest"]
			const parsedModel = parseOllamaModel(modelData)

			expect(parsedModel).toEqual({
				maxTokens: 4096, // kilocode_change
				contextWindow: 4096, // kilocode_change
				supportsImages: false,
				supportsPromptCache: true,
				supportsNativeTools: true,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description: "Family: qwen3, Context: 4096, Size: 32.8B", // kilocode_change
			})
		})

		it("should handle models with null families field", () => {
			const modelDataWithNullFamilies = {
				...ollamaModelsData["qwen3-2to16:latest"],
				details: {
					...ollamaModelsData["qwen3-2to16:latest"].details,
					families: null,
				},
			}

			const parsedModel = parseOllamaModel(modelDataWithNullFamilies as any)

			expect(parsedModel).toEqual({
				maxTokens: 4096, // kilocode_change
				contextWindow: 4096, // kilocode_change
				supportsImages: false,
				supportsPromptCache: true,
				supportsNativeTools: true,
				inputPrice: 0,
				outputPrice: 0,
				cacheWritesPrice: 0,
				cacheReadsPrice: 0,
				description: "Family: qwen3, Context: 4096, Size: 32.8B", // kilocode_change
			})
		})

		// kilocode_change: should return model with supportsNativeTools=false when capabilities does not include 'tools'
		it("should return model with supportsNativeTools=false when capabilities does not include 'tools'", () => {
			const modelDataWithoutTools = {
				...ollamaModelsData["qwen3-2to16:latest"],
				capabilities: ["completion"], // No "tools" capability
			}

			const parsedModel = parseOllamaModel(modelDataWithoutTools as any)

			// kilocode_change start: Models without tools capability are still returned (for autocomplete), but marked as not supporting tools
			expect(parsedModel).not.toBeNull()
			expect(parsedModel!.supportsNativeTools).toBe(false)
			// kilocode_change end
		})

		it("should return model info when capabilities includes 'tools'", () => {
			const modelDataWithTools = {
				...ollamaModelsData["qwen3-2to16:latest"],
				capabilities: ["completion", "tools"], // Has "tools" capability
			}

			const parsedModel = parseOllamaModel(modelDataWithTools as any)

			expect(parsedModel).not.toBeNull()
			expect(parsedModel!.supportsNativeTools).toBe(true)
		})

		// kilocode_change: should return model with supportsNativeTools=false when capabilities is undefined
		it("should return model with supportsNativeTools=false when capabilities is undefined", () => {
			const modelDataWithoutCapabilities = {
				...ollamaModelsData["qwen3-2to16:latest"],
				capabilities: undefined, // No capabilities array
			}

			const parsedModel = parseOllamaModel(modelDataWithoutCapabilities as any)

			// kilocode_change start: Models without explicit tools capability are still returned (for autocomplete)
			expect(parsedModel).not.toBeNull()
			expect(parsedModel!.supportsNativeTools).toBe(false)
			// kilocode_change end
		})

		// kilocode_change: should return model with vision but supportsNativeTools=false when no tools capability
		it("should return model with vision but supportsNativeTools=false when no tools capability", () => {
			const modelDataWithVision = {
				...ollamaModelsData["qwen3-2to16:latest"],
				capabilities: ["completion", "vision"],
			}

			const parsedModel = parseOllamaModel(modelDataWithVision as any)

			// kilocode_change start: No "tools" capability but model is still returned (for autocomplete/vision tasks)
			expect(parsedModel).not.toBeNull()
			expect(parsedModel!.supportsImages).toBe(true)
			expect(parsedModel!.supportsNativeTools).toBe(false)
			// kilocode_change
		})

		it("should return model with both vision and tools when both capabilities present", () => {
			const modelDataWithBoth = {
				...ollamaModelsData["qwen3-2to16:latest"],
				capabilities: ["completion", "vision", "tools"],
			}

			const parsedModel = parseOllamaModel(modelDataWithBoth as any)

			expect(parsedModel).not.toBeNull()
			expect(parsedModel!.supportsImages).toBe(true)
			expect(parsedModel!.supportsNativeTools).toBe(true)
		})
	})

	describe("getOllamaModels", () => {
		// kilocode_change: should fetch model list from /api/tags and include all models
		it("should fetch model list from /api/tags and include all models", async () => {
			const baseUrl = "http://localhost:11434"
			const modelName = "devstral2to16:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: ["llama"],
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: ["llama"],
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion", "tools"], // Has tools capability
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`, { headers: {} })

			expect(mockedAxios.post).toHaveBeenCalledTimes(1)
			expect(mockedAxios.post).toHaveBeenCalledWith(`${baseUrl}/api/show`, { model: modelName }, { headers: {} })

			expect(typeof result).toBe("object")
			expect(result).not.toBeInstanceOf(Array)
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()

			const expectedParsedDetails = parseOllamaModel(mockApiShowResponse as any)
			expect(result[modelName]).toEqual(expectedParsedDetails)
		})

		// kilocode_change: should include models without tools capability but mark supportsNativeTools=false
		it("should include models without tools capability but mark supportsNativeTools=false", async () => {
			const baseUrl = "http://localhost:11434"
			const modelName = "no-tools-model:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: ["llama"],
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: ["llama"],
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion"], // No tools capability
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl)

			// kilocode_change start: Model without tools capability is now included (for autocomplete), but marked as not supporting tools
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()
			expect(result[modelName].supportsNativeTools).toBe(false)
			// kilocode_change end
		})

		it("should return an empty list if the initial /api/tags call fails", async () => {
			const baseUrl = "http://localhost:11434"
			mockedAxios.get.mockRejectedValueOnce(new Error("Network error"))
			const consoleInfoSpy = vi.spyOn(console, "error").mockImplementation(() => {}) // Spy and suppress output

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`, { headers: {} })
			expect(mockedAxios.post).not.toHaveBeenCalled()
			expect(result).toEqual({})
		})

		it("should log an info message and return an empty object on ECONNREFUSED", async () => {
			const baseUrl = "http://localhost:11434"
			const consoleInfoSpy = vi.spyOn(console, "warn").mockImplementation(() => {}) // Spy and suppress output

			const econnrefusedError = new Error("Connection refused") as any
			econnrefusedError.code = "ECONNREFUSED"
			mockedAxios.get.mockRejectedValueOnce(econnrefusedError)

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`, { headers: {} })
			expect(mockedAxios.post).not.toHaveBeenCalled()
			expect(consoleInfoSpy).toHaveBeenCalledWith(`Failed connecting to Ollama at ${baseUrl}`)
			expect(result).toEqual({})

			consoleInfoSpy.mockRestore() // Restore original console.info
		})

		it("should handle models with null families field in API response", async () => {
			const baseUrl = "http://localhost:11434"
			const modelName = "test-model:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: null, // This is the case we're testing
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: null, // This is the case we're testing
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion", "tools"], // Has tools capability
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl)

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`, { headers: {} })

			expect(mockedAxios.post).toHaveBeenCalledTimes(1)
			expect(mockedAxios.post).toHaveBeenCalledWith(`${baseUrl}/api/show`, { model: modelName }, { headers: {} })

			expect(typeof result).toBe("object")
			expect(result).not.toBeInstanceOf(Array)
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()

			// Verify the model was parsed correctly despite null families
			expect(result[modelName].description).toBe("Family: llama, Context: 4096, Size: 23.6B")
		})

		it("should include Authorization header when API key is provided", async () => {
			const baseUrl = "http://localhost:11434"
			const apiKey = "test-api-key-123"
			const modelName = "test-model:latest"

			const mockApiTagsResponse = {
				models: [
					{
						name: modelName,
						model: modelName,
						modified_at: "2025-06-03T09:23:22.610222878-04:00",
						size: 14333928010,
						digest: "6a5f0c01d2c96c687d79e32fdd25b87087feb376bf9838f854d10be8cf3c10a5",
						details: {
							family: "llama",
							families: ["llama"],
							format: "gguf",
							parameter_size: "23.6B",
							parent_model: "",
							quantization_level: "Q4_K_M",
						},
					},
				],
			}
			const mockApiShowResponse = {
				license: "Mock License",
				modelfile: "FROM /path/to/blob\nTEMPLATE {{ .Prompt }}",
				parameters: "num_ctx 4096\nstop_token <eos>",
				template: "{{ .System }}USER: {{ .Prompt }}ASSISTANT:",
				modified_at: "2025-06-03T09:23:22.610222878-04:00",
				details: {
					parent_model: "",
					format: "gguf",
					family: "llama",
					families: ["llama"],
					parameter_size: "23.6B",
					quantization_level: "Q4_K_M",
				},
				model_info: {
					"ollama.context_length": 4096,
					"some.other.info": "value",
				},
				capabilities: ["completion", "tools"], // Has tools capability
			}

			mockedAxios.get.mockResolvedValueOnce({ data: mockApiTagsResponse })
			mockedAxios.post.mockResolvedValueOnce({ data: mockApiShowResponse })

			const result = await getOllamaModels(baseUrl, apiKey)

			const expectedHeaders = { Authorization: `Bearer ${apiKey}` }

			expect(mockedAxios.get).toHaveBeenCalledTimes(1)
			expect(mockedAxios.get).toHaveBeenCalledWith(`${baseUrl}/api/tags`, { headers: expectedHeaders })

			expect(mockedAxios.post).toHaveBeenCalledTimes(1)
			expect(mockedAxios.post).toHaveBeenCalledWith(
				`${baseUrl}/api/show`,
				{ model: modelName },
				{ headers: expectedHeaders },
			)

			expect(typeof result).toBe("object")
			expect(result).not.toBeInstanceOf(Array)
			expect(Object.keys(result).length).toBe(1)
			expect(result[modelName]).toBeDefined()
		})
	})
})
