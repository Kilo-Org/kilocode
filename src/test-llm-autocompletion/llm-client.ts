import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import "dotenv/config"

export interface LLMResponse {
	content: string
	provider: string
	model: string
	tokensUsed?: number
}

export class LLMClient {
	private provider: string
	private model: string
	private anthropic?: Anthropic
	private openai?: OpenAI

	constructor() {
		this.provider = process.env.LLM_PROVIDER || "anthropic"
		this.model = process.env.LLM_MODEL || "claude-3-haiku-20240307"

		switch (this.provider) {
			case "anthropic":
				if (!process.env.ANTHROPIC_API_KEY) {
					throw new Error("ANTHROPIC_API_KEY is required for Anthropic provider")
				}
				this.anthropic = new Anthropic({
					apiKey: process.env.ANTHROPIC_API_KEY,
				})
				break

			case "openai":
				if (!process.env.OPENAI_API_KEY) {
					throw new Error("OPENAI_API_KEY is required for OpenAI provider")
				}
				this.openai = new OpenAI({
					apiKey: process.env.OPENAI_API_KEY,
				})
				break

			case "openrouter":
				if (!process.env.OPENROUTER_API_KEY) {
					throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider")
				}
				this.openai = new OpenAI({
					baseURL: "https://openrouter.ai/api/v1",
					apiKey: process.env.OPENROUTER_API_KEY,
					defaultHeaders: {
						"HTTP-Referer": "https://github.com/kilocode/test-suite",
						"X-Title": "Kilo Code Autocompletion Tests",
					},
				})
				break

			default:
				throw new Error(`Unsupported provider: ${this.provider}`)
		}
	}

	async sendPrompt(systemPrompt: string, userPrompt: string): Promise<LLMResponse> {
		try {
			if (this.provider === "anthropic" && this.anthropic) {
				const response = await this.anthropic.messages.create({
					model: this.model,
					max_tokens: 1024,
					messages: [{ role: "user", content: userPrompt }],
					system: systemPrompt,
				})

				return {
					content: response.content[0].type === "text" ? response.content[0].text : "",
					provider: this.provider,
					model: this.model,
					tokensUsed: response.usage?.output_tokens,
				}
			}

			if ((this.provider === "openai" || this.provider === "openrouter") && this.openai) {
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
			}

			throw new Error("No LLM client configured")
		} catch (error) {
			console.error("LLM API Error:", error)
			throw error
		}
	}
}
