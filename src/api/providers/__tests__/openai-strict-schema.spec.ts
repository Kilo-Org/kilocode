import { BaseProvider } from "../base-provider"
import { normalizeObjectAdditionalPropertiesFalse } from "../kilocode/openai-strict-schema"

class TestProvider extends BaseProvider {
	// Minimal implementations for abstract base class
	createMessage(): any {
		throw new Error("not used")
	}

	getModel(): any {
		return { id: "test", info: {} }
	}

	public convertTools(tools: any[]): any[] | undefined {
		return this.convertToolsForOpenAI(tools)
	}

	public convertSchema(schema: any): any {
		return this.convertToolSchemaForOpenAI(schema)
	}
}

describe("OpenAI strict schema helpers", () => {
	test("normalizeObjectAdditionalPropertiesFalse adds additionalProperties:false for nested objects with properties", () => {
		const schema = {
			type: "object",
			additionalProperties: false,
			properties: {
				inputs: {
					type: "object",
					properties: {
						ref: { type: "string" },
					},
					// additionalProperties intentionally missing
				},
			},
		}

		const normalized = normalizeObjectAdditionalPropertiesFalse(schema)
		expect(normalized.properties.inputs.additionalProperties).toBe(false)
	})
})

describe("BaseProvider.convertToolsForOpenAI", () => {
	test("adds additionalProperties:false during schema conversion", () => {
		const provider = new TestProvider()
		const schema = {
			type: "object",
			properties: {
				inputs: {
					type: "object",
					properties: {
						ref: { type: "string" },
					},
				},
			},
		}

		const converted = provider.convertSchema(schema)
		expect(converted.properties.inputs.additionalProperties).toBe(false)
	})
})
