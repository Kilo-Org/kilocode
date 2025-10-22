import OpenAI from "openai"
import { config } from "dotenv"
import { DEFAULT_HEADERS } from "../api/providers/constants.js"
import { getKiloUrlFromToken } from "../shared/kilocode/token.js"

config()

export interface LLMResponse {
	content: string
	provider: string
	model: string
	tokensUsed?: number
}

export class LLMClient {
	private provider: string
	private model: string
	private openai: OpenAI

	constructor() {
		this.provider = process.env.LLM_PROVIDER || "kilocode"
		this.model = process.env.LLM_MODEL || "mistralai/codestral-2508"

		if (this.provider !== "kilocode") {
			throw new Error(`Only kilocode provider is supported. Got: ${this.provider}`)
		}

		if (!process.env.KILOCODE_API_KEY) {
			throw new Error("KILOCODE_API_KEY is required for Kilocode provider")
		}

		const baseURL = getKiloUrlFromToken(process.env.KILOCODE_API_KEY, "https://api.kilocode.ai/api/openrouter/")
		this.openai = new OpenAI({
			baseURL,
			apiKey: process.env.KILOCODE_API_KEY,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				"X-KILOCODE-TESTER": "SUPPRESS",
			},
		})
	}

	async sendPrompt(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
		try {
			const response = await this.openai.chat.completions.create({
				model: this.model,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				max_tokens: 1024,
			})

			return {
				content: response.choices[0].message.content || "",
				provider: this.provider,
				model: this.model,
				tokensUsed: response.usage?.total_tokens,
			}
		} catch (error) {
			console.error("LLM API Error:", error)
			throw error
		}
	}
}
