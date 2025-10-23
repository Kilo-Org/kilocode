import { describe, expect, test } from "vitest"
import { encodingForModel, countTokens } from "./countTokens"
import { llamaTokenizer } from "./llamaTokenizer.js"
import { encodingForModel as tiktokenEncodingForModel } from "js-tiktoken"

describe("encodingForModel()", () => {
	const sample = "Hello, world! 12345\nThe quick brown fox jumps."

	test("uses js-tiktoken for GPT/OpenAI/Claude-like models", () => {
		const encs = [
			"gpt-4",
			"o3-mini",
			"o4",
			"claude-3",
			"claude-3-7-sonnet-20250219",
			"amazon-nova-pro",
			"command-r",
			"gemini-1.5-pro",
			"grok-beta",
			"moonshot-v1",
			"mercury-chat",
			"pplx-70b",
			"chat-bison",
		]

		const tiktoken = tiktokenEncodingForModel("gpt-4")

		for (const name of encs) {
			const enc = encodingForModel(name)
			const got = enc.encode(sample).length
			const expected = tiktoken.encode(sample).length
			expect(got).toBe(expected)
		}
	})

	test("uses llama tokenizer for Llama-family and similar local models", () => {
		const encs = [
			"llama2",
			"llama-2",
			"llama3",
			"llama-3-8b-instruct",
			"mistral-7b",
			"mixtral-8x7b",
			"deepseek-coder",
			"tinyllama",
			"xwin-coder",
			"zephyr-7b",
			"openchat",
			"neural-chat",
			"granite2:8b",
		]

		for (const name of encs) {
			const enc = encodingForModel(name)
			const got = enc.encode(sample).length
			const expected = llamaTokenizer.encode(sample).length
			expect(got).toBe(expected)
		}
	})
})

describe("countTokens()", () => {
	test("uses llama tokenizer path when appropriate", () => {
		const s = "A llama-friendly test string: symbols • unicode ✓ accents café 🌟"
		const expected = llamaTokenizer.encode(s).length

		expect(countTokens(s, "llama2")).toBe(expected)
		expect(countTokens(s, "llama-3")).toBe(expected)
		// DeepSeek and many open-source models default to llama tokenizer here
		expect(countTokens(s, "deepseek")).toBe(expected)
	})

	test("uses js-tiktoken for GPT-like models", () => {
		const s = "Testing GPT token route: inline checks with numbers 12345."
		const tiktoken = tiktokenEncodingForModel("gpt-4")
		const expected = tiktoken.encode(s).length

		expect(countTokens(s, "gpt-4")).toBe(expected)
		expect(countTokens(s, "o3-mini")).toBe(expected)
		expect(countTokens(s, "claude-3")).toBe(expected)
	})
})
