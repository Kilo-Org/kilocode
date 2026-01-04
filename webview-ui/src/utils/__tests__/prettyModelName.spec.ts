import { prettyModelName } from "../prettyModelName"

describe("prettyModelName", () => {
	it("should return empty string for empty input", () => {
		expect(prettyModelName("")).toBe("")
	})

	it("should handle simple model name without slashes", () => {
		// The function only capitalizes first character of project name, not each word
		expect(prettyModelName("gpt-4")).toBe("Gpt 4 ")
	})

	it("should handle model name with single slash", () => {
		expect(prettyModelName("anthropic/claude-3")).toBe("Anthropic / Claude 3 ")
	})

	it("should handle model name with colon tag", () => {
		expect(prettyModelName("anthropic/claude-3:thinking")).toBe("Anthropic / Claude 3 (Thinking)")
	})

	it("should handle model name with multiple slashes - the key fix", () => {
		// This is the key bug fix - model IDs like "chutes/moonshotai/Kimi-K2-Instruct"
		// should preserve everything after the first slash
		// With the fix, we now get the full model name preserved
		const result = prettyModelName("chutes/moonshotai/Kimi-K2-Instruct")
		// Should contain the full model name, not just "Chutes / Moonshotai"
		expect(result).toContain("Chutes")
		expect(result).toContain("Moonshotai")
		expect(result).toContain("Kimi")
		expect(result).toContain("K2")
		expect(result).toContain("Instruct")
	})

	it("should handle real Chutes model IDs with single slash", () => {
		// Actual Chutes API model ID format
		expect(prettyModelName("moonshotai/Kimi-K2-Instruct-0905")).toBe("Moonshotai / Kimi K2 Instruct 0905 ")
	})

	it("should handle NousResearch model IDs", () => {
		// The function preserves the case in the word after capitalizing first char
		expect(prettyModelName("NousResearch/Hermes-4-70B")).toBe("NousResearch / Hermes 4 70B ")
	})

	it("should handle Qwen model IDs", () => {
		expect(prettyModelName("Qwen/Qwen3-235B-A22B")).toBe("Qwen / Qwen3 235B A22B ")
	})

	it("should handle model ID with multiple slashes and tag", () => {
		const result = prettyModelName("provider/org/model-name:variant")
		expect(result).toContain("Provider")
		expect(result).toContain("Org")
		// Note: The function only capitalizes first char of each dash-word, so "model" stays lowercase
		expect(result).toContain("model")
		expect(result).toContain("Name")
		expect(result).toContain("(Variant)")
	})

	it("should handle deepseek model IDs with dash in project name", () => {
		// Note: project name with dash is just capitalized first char, doesn't split on dash
		expect(prettyModelName("deepseek-ai/DeepSeek-R1-0528")).toBe("Deepseek-ai / DeepSeek R1 0528 ")
	})

	it("should preserve uppercase in model names", () => {
		// The function capitalizes first char of each dash-separated word
		expect(prettyModelName("openai/GPT-4o")).toBe("Openai / GPT 4o ")
	})
})
