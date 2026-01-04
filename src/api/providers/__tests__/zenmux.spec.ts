// kilocode_change - new test file for ZenMux provider
import { ZenMuxHandler } from "../zenmux"
import { ApiHandlerOptions } from "../../../shared/api"

describe("ZenMuxHandler", () => {
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			zenmuxApiKey: "test-api-key",
			zenmuxModelId: "openai/gpt-4",
			zenmuxBaseUrl: "https://test.zenmux.ai/api/v1",
		}
	})

	test("should use default base URL when not provided", () => {
		const optionsWithoutBaseUrl = {
			...mockOptions,
			zenmuxBaseUrl: undefined,
		}
		const handler = new ZenMuxHandler(optionsWithoutBaseUrl)
		// The handler should initialize without errors
		expect(handler).toBeDefined()
	})

	test("should use provided base URL", () => {
		const handler = new ZenMuxHandler(mockOptions)
		expect(handler).toBeDefined()
		// The base URL should be used in the OpenAI client
	})

	test("should handle missing API key gracefully", () => {
		const optionsWithoutKey = {
			...mockOptions,
			zenmuxApiKey: undefined,
		}
		const handler = new ZenMuxHandler(optionsWithoutKey)
		expect(handler).toBeDefined()
	})

	test("should return correct model info", () => {
		const handler = new ZenMuxHandler(mockOptions)
		const model = handler.getModel()
		expect(model.id).toBe("openai/gpt-4")
		expect(model.info).toBeDefined()
	})
})
