import OpenAI from "openai"
import { DEFAULT_HEADERS } from "../api/providers/constants.js"
import { getKiloBaseUriFromToken } from "./llm-client.js"
import { ContextFile } from "./test-cases.js"

const OPUS_MODEL = "anthropic/claude-opus-4.5"

export async function askOpusApproval(
	input: string,
	output: string,
	completion: string,
	filename: string,
	contextFiles: ContextFile[],
	previouslyApproved: string[],
	previouslyRejected: string[],
): Promise<"APPROVED" | "REJECTED" | "UNCERTAIN"> {
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

APPROVE if ALL of these are true:
✓ Adds 3+ meaningful characters (not just punctuation/whitespace)
✓ Syntactically valid in the given context
✓ Logically continues the code pattern
✓ Does not duplicate existing code

REJECT if ANY of these are true:
✗ Only adds closing brackets, semicolons, quotes, or whitespace
✗ Empty or contains only 1-2 trivial characters
✗ Contains syntax errors
✗ Nonsensical or irrelevant in context
✗ Repeats code that already exists

UNCERTAIN if:
? Borderline case that could go either way
? Technically valid but questionable usefulness

Respond with ONLY one of: "APPROVED", "REJECTED", or "UNCERTAIN"`

	let userPrompt = `FILENAME: ${filename}

CODE WITH CURSOR (<<<AUTOCOMPLETE_HERE>>> marks where completion is inserted):
\`\`\`
${input}
\`\`\`

COMPLETION (the suggested text to insert at cursor):
\`\`\`
${completion}
\`\`\`

RESULT AFTER COMPLETION:
\`\`\`
${output}
\`\`\`
`

	// Add context files if available
	if (contextFiles.length > 0) {
		userPrompt += `\n--- CONTEXT FILES (other files in the project given to the autocomplete as context) ---\n`
		for (const contextFile of contextFiles) {
			userPrompt += `\nFile: ${contextFile.filepath}\n\`\`\`\n${contextFile.content}\n\`\`\`\n`
		}
	}

	// Add previously approved outputs as examples (max 3)
	const approvedExamples = previouslyApproved.slice(0, 3)
	if (approvedExamples.length > 0) {
		userPrompt += `\n--- PREVIOUSLY APPROVED OUTPUTS (for reference) ---\n`
		for (let i = 0; i < approvedExamples.length; i++) {
			userPrompt += `\nApproved example ${i + 1}:\n\`\`\`\n${approvedExamples[i]}\n\`\`\`\n`
		}
	}

	// Add previously rejected outputs as examples (max 3)
	const rejectedExamples = previouslyRejected.slice(0, 3)
	if (rejectedExamples.length > 0) {
		userPrompt += `\n--- PREVIOUSLY REJECTED OUTPUTS (for reference) ---\n`
		for (let i = 0; i < rejectedExamples.length; i++) {
			userPrompt += `\nRejected example ${i + 1}:\n\`\`\`\n${rejectedExamples[i]}\n\`\`\`\n`
		}
	}

	userPrompt += `\nIs this autocomplete suggestion useful? Respond with ONLY "APPROVED", "REJECTED", or "UNCERTAIN".`

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
		if (content === "APPROVED") {
			return "APPROVED"
		} else if (content === "REJECTED") {
			return "REJECTED"
		}
		return "UNCERTAIN"
	} catch (error) {
		console.error("Opus approval error:", error)
		throw error
	}
}
