import OpenAI from "openai"
import { DEFAULT_HEADERS } from "../api/providers/constants.js"
import { getKiloBaseUriFromToken } from "./llm-client.js"

const OPUS_MODEL = "anthropic/claude-opus-4.5"

export async function askOpusApproval(
	input: string,
	output: string,
	previouslyApproved: string[],
	previouslyRejected: string[],
): Promise<boolean> {
	const apiKey = process.env.KILOCODE_API_KEY
	if (!apiKey) {
		throw new Error("KILOCODE_API_KEY is required for Opus auto-approval")
	}

	const baseUrl = getKiloBaseUriFromToken(apiKey)
	const openai = new OpenAI({
		baseURL: `${baseUrl}/api/openrouter/`,
		apiKey,
		defaultHeaders: {
			...DEFAULT_HEADERS,
			"X-KILOCODE-TESTER": "SUPPRESS",
		},
	})

	const systemPrompt = `You are an expert code reviewer evaluating autocomplete suggestions.
Your task is to determine if an autocomplete suggestion is USEFUL or NOT USEFUL.

A suggestion is USEFUL if it:
- Provides meaningful code that helps the developer
- Completes a logical code pattern
- Adds substantial functionality (not just trivial characters)
- Is syntactically correct and contextually appropriate

A suggestion is NOT USEFUL if it:
- Only adds trivial characters like semicolons, closing brackets, or single characters
- Is empty or nearly empty
- Is syntactically incorrect
- Doesn't make sense in the context
- Repeats what's already there

Respond with ONLY "APPROVED" or "REJECTED" - nothing else.`

	let userPrompt = `Here is the code context (with cursor position marked by where the completion would be inserted):

INPUT (code before completion):
\`\`\`
${input}
\`\`\`

OUTPUT (code after completion):
\`\`\`
${output}
\`\`\`
`

	// Add previously approved outputs as examples
	if (previouslyApproved.length > 0) {
		userPrompt += `\n--- PREVIOUSLY APPROVED OUTPUTS (for reference) ---\n`
		for (let i = 0; i < previouslyApproved.length; i++) {
			userPrompt += `\nApproved example ${i + 1}:\n\`\`\`\n${previouslyApproved[i]}\n\`\`\`\n`
		}
	}

	// Add previously rejected outputs as examples
	if (previouslyRejected.length > 0) {
		userPrompt += `\n--- PREVIOUSLY REJECTED OUTPUTS (for reference) ---\n`
		for (let i = 0; i < previouslyRejected.length; i++) {
			userPrompt += `\nRejected example ${i + 1}:\n\`\`\`\n${previouslyRejected[i]}\n\`\`\`\n`
		}
	}

	userPrompt += `\nIs this autocomplete suggestion useful? Respond with ONLY "APPROVED" or "REJECTED".`

	try {
		const response = await openai.chat.completions.create({
			model: OPUS_MODEL,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			max_tokens: 10,
			temperature: 0,
		})

		const content = response.choices[0].message.content?.trim().toUpperCase() || ""
		return content === "APPROVED"
	} catch (error) {
		console.error("Opus approval error:", error)
		throw error
	}
}
