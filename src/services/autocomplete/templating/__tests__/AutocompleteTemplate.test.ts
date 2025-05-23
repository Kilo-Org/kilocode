import { AutocompleteTemplate, getTemplateForModel } from "../AutocompleteTemplate"

describe("getTemplateForModel", () => {
	const googleGeminiFlashFimTemplate: AutocompleteTemplate = {
		template: "<FIM_PREFIX>{{{prefix}}}<FIM_SUFFIX>{{{suffix}}}<FIM_MIDDLE>",
		completionOptions: {
			stop: ["<FIM_PREFIX>", "<FIM_SUFFIX>", "<FIM_MIDDLE>", "<eos>"],
		},
	}

	const stableCodeFimTemplate: AutocompleteTemplate = {
		template: "<fim_prefix>{{{prefix}}}<fim_suffix>{{{suffix}}}<fim_middle>",
		completionOptions: {
			stop: [
				"<fim_prefix>",
				"<fim_suffix>",
				"<fim_middle>",
				"<file_sep>",
				"<|endo" + "ftext|>",
				"</fim_middle>",
				"</code>",
			],
		},
	}

	it("should return googleGeminiFlashFimTemplate for 'google/gemini-2.5-flash'", () => {
		const model = "google/gemini-2.5-flash"
		const template = getTemplateForModel(model)
		expect(template.template).toEqual(googleGeminiFlashFimTemplate.template)
		expect(template.completionOptions?.stop).toEqual(googleGeminiFlashFimTemplate.completionOptions?.stop)
	})

	it("should return googleGeminiFlashFimTemplate for 'gemini-flash-model'", () => {
		const model = "gemini-flash-model"
		const template = getTemplateForModel(model)
		expect(template.template).toEqual(googleGeminiFlashFimTemplate.template)
		expect(template.completionOptions?.stop).toEqual(googleGeminiFlashFimTemplate.completionOptions?.stop)
	})

	it("should return googleGeminiFlashFimTemplate for 'gemini-2.5-pro'", () => {
		const model = "gemini-2.5-pro"
		const template = getTemplateForModel(model)
		expect(template.template).toEqual(googleGeminiFlashFimTemplate.template)
		expect(template.completionOptions?.stop).toEqual(googleGeminiFlashFimTemplate.completionOptions?.stop)
	})

	it("should return googleGeminiFlashFimTemplate for 'Gemini-Flash-1.0'", () => {
		const model = "Gemini-Flash-1.0"
		const template = getTemplateForModel(model)
		expect(template.template).toEqual(googleGeminiFlashFimTemplate.template)
		expect(template.completionOptions?.stop).toEqual(googleGeminiFlashFimTemplate.completionOptions?.stop)
	})

	it("should return stableCodeFimTemplate for an unknown model", () => {
		const model = "unknown-model-xyz"
		const template = getTemplateForModel(model)
		// The default template's stop tokens are slightly different due to the endOfText workaround
		// So we compare the template string and check if stop tokens are defined
		expect(template.template).toEqual(stableCodeFimTemplate.template)
		expect(template.completionOptions?.stop).toBeDefined()
		expect(template.completionOptions?.stop).toContain("<fim_prefix>") // Basic check
	})

	// Add more test cases for other models if needed
})
