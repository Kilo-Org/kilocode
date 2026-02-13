// kilocode_change - new file
import { createValidationSchema } from "../CodeIndexPopover"

const t = (key: string) => key

const buildOpenAiCompatiblePayload = (overrides: Record<string, unknown> = {}) => ({
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: "http://localhost:6333",
	codebaseIndexOpenAiCompatibleBaseUrl: "http://localhost:8080",
	codebaseIndexOpenAiCompatibleApiKey: "",
	codebaseIndexEmbedderModelId: "text-embedding-3-small",
	codebaseIndexEmbedderModelDimension: 1536,
	...overrides,
})

describe("CodeIndexPopover openai-compatible validation schema", () => {
	it("accepts empty API key", () => {
		const schema = createValidationSchema("openai-compatible", t)
		const result = schema.safeParse(buildOpenAiCompatiblePayload())

		expect(result.success).toBe(true)
	})

	it("rejects missing base URL", () => {
		const schema = createValidationSchema("openai-compatible", t)
		const result = schema.safeParse(
			buildOpenAiCompatiblePayload({
				codebaseIndexOpenAiCompatibleBaseUrl: "",
			}),
		)

		expect(result.success).toBe(false)
		expect(result.error?.issues.some((issue) => issue.path[0] === "codebaseIndexOpenAiCompatibleBaseUrl")).toBe(
			true,
		)
	})

	it("rejects malformed base URL", () => {
		const schema = createValidationSchema("openai-compatible", t)
		const result = schema.safeParse(
			buildOpenAiCompatiblePayload({
				codebaseIndexOpenAiCompatibleBaseUrl: "not-a-valid-url",
			}),
		)

		expect(result.success).toBe(false)
		expect(result.error?.issues.some((issue) => issue.path[0] === "codebaseIndexOpenAiCompatibleBaseUrl")).toBe(
			true,
		)
	})
})
