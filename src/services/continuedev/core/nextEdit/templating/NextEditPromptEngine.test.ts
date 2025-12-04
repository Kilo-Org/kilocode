import { describe, expect, it } from "vitest"
import { NEXT_EDIT_MODELS } from "../../llm/constants"
import {
	INSTINCT_USER_PROMPT_PREFIX,
	MERCURY_CURRENT_FILE_CONTENT_CLOSE,
	MERCURY_CURRENT_FILE_CONTENT_OPEN,
	MERCURY_EDIT_DIFF_HISTORY_CLOSE,
	MERCURY_EDIT_DIFF_HISTORY_OPEN,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE,
	MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN,
} from "../constants"
import { NEXT_EDIT_MODEL_TEMPLATES, getTemplateForModel } from "./NextEditPromptEngine"
import { TemplateVars } from "../types"
const fakeTemplateVars = {
	languageShorthand: "AAA",
	contextSnippets: "BBB",
	currentFileContent: "CCC",
	currentFilePath: "DDD",
	editDiffHistory: "EEE",
	recentlyViewedCodeSnippets: "FFF",
} satisfies TemplateVars
describe("NextEditPromptEngine", () => {
	describe("NEXT_EDIT_MODEL_TEMPLATES", () => {
		it("should contain templates for all supported models", () => {
			expect(NEXT_EDIT_MODEL_TEMPLATES).toHaveProperty(NEXT_EDIT_MODELS.MERCURY_CODER)
			expect(NEXT_EDIT_MODEL_TEMPLATES).toHaveProperty(NEXT_EDIT_MODELS.INSTINCT)
		})

		it("mercury-coder template should contain expected tokens", () => {
			const result = NEXT_EDIT_MODEL_TEMPLATES[NEXT_EDIT_MODELS.MERCURY_CODER](fakeTemplateVars)

			expect(result).toContain(MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_OPEN)
			expect(result).toContain(MERCURY_RECENTLY_VIEWED_CODE_SNIPPETS_CLOSE)
			expect(result).toContain(MERCURY_CURRENT_FILE_CONTENT_OPEN)
			expect(result).toContain(MERCURY_CURRENT_FILE_CONTENT_CLOSE)
			expect(result).toContain(MERCURY_EDIT_DIFF_HISTORY_OPEN)
			expect(result).toContain(MERCURY_EDIT_DIFF_HISTORY_CLOSE)
			expect(result).toContain("FFF")
			expect(result).toContain("CCC")
			expect(result).toContain("EEE")
		})

		it("instinct template should contain expected tokens", () => {
			const result = NEXT_EDIT_MODEL_TEMPLATES[NEXT_EDIT_MODELS.INSTINCT](fakeTemplateVars)

			expect(result).toContain(INSTINCT_USER_PROMPT_PREFIX)
			expect(result).toContain("### Context:")
			expect(result).toContain("### User Edits:")
			expect(result).toContain("### User Excerpt:")
			expect(result).toContain("BBB")
			expect(result).toContain("CCC")
			expect(result).toContain("EEE")
			expect(result).toContain("DDD")
		})
	})

	describe("getTemplateForModel", () => {
		it("should return the correct template for a supported model", () => {
			const template = getTemplateForModel(NEXT_EDIT_MODELS.MERCURY_CODER)
			expect(template).toBe(NEXT_EDIT_MODEL_TEMPLATES[NEXT_EDIT_MODELS.MERCURY_CODER])
		})

		it("should throw an error for an unsupported model", () => {
			expect(() => getTemplateForModel("unsupported" as NEXT_EDIT_MODELS)).toThrow(
				"Model unsupported is not supported for next edit.",
			)
		})
	})
})
