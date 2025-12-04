import fs from "fs"
import path from "path"
import readline from "readline"
import OpenAI from "openai"
import { DEFAULT_HEADERS } from "../api/providers/constants.js"

const APPROVALS_DIR = "approvals"
const OPUS_MODEL = "anthropic/claude-opus-4.5"

export interface ApprovalResult {
	isApproved: boolean
	newOutput: boolean
}

function getKiloBaseUriFromToken(kilocodeToken?: string): string {
	if (kilocodeToken) {
		try {
			const payload_string = kilocodeToken.split(".")[1]
			const payload_json = Buffer.from(payload_string, "base64").toString()
			const payload = JSON.parse(payload_json)
			if (payload.env === "development") return "http://localhost:3000"
		} catch (_error) {
			console.warn("Failed to get base URL from Kilo Code token")
		}
	}
	return "https://api.kilo.ai"
}

function getExistingOutputs(categoryDir: string, testName: string, type: "approved" | "rejected"): string[] {
	if (!fs.existsSync(categoryDir)) {
		return []
	}

	const pattern = new RegExp(`^${testName}\\.${type}\\.\\d+\\.txt$`)
	const files = fs.readdirSync(categoryDir).filter((f) => pattern.test(f))

	return files.map((file) => {
		const filePath = path.join(categoryDir, file)
		return fs.readFileSync(filePath, "utf-8")
	})
}

async function askOpusApproval(
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

function getCategoryPath(category: string): string {
	return path.join(APPROVALS_DIR, category)
}

function getNextFileNumber(categoryDir: string, testName: string, type: "approved" | "rejected"): number {
	if (!fs.existsSync(categoryDir)) {
		return 1
	}

	const files = fs.readdirSync(categoryDir)
	const pattern = new RegExp(`^${testName}\\.${type}\\.(\\d+)\\.txt$`)
	const numbers = files
		.filter((f) => pattern.test(f))
		.map((f) => {
			const match = f.match(pattern)
			return match ? parseInt(match[1], 10) : 0
		})

	return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
}

function findMatchingFile(
	categoryDir: string,
	testName: string,
	type: "approved" | "rejected",
	content: string,
): string | null {
	if (!fs.existsSync(categoryDir)) {
		return null
	}

	const pattern = new RegExp(`^${testName}\\.${type}\\.\\d+\\.txt$`)
	const files = fs.readdirSync(categoryDir).filter((f) => pattern.test(f))

	for (const file of files) {
		const filePath = path.join(categoryDir, file)
		const fileContent = fs.readFileSync(filePath, "utf-8")
		if (fileContent.trim() === content.trim()) {
			return file
		}
	}

	return null
}

async function askUserApproval(category: string, testName: string, input: string, output: string): Promise<boolean> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		console.log("\n" + "═".repeat(80))
		console.log(`\n🔍 New output detected for: ${category}/${testName}\n`)
		console.log("Input:")
		console.log("─".repeat(80))
		console.log(input)
		console.log("─".repeat(80))
		console.log("\nOutput:")
		console.log("─".repeat(80))
		console.log(output)
		console.log("─".repeat(80))
		console.log("\n" + "─".repeat(80))

		rl.question("\nIs this acceptable? [Y/n]: ", (answer) => {
			rl.close()
			const trimmed = answer.trim().toLowerCase()
			const isApproved = trimmed === "" || trimmed === "y" || trimmed === "yes"
			resolve(isApproved)
		})
	})
}

export async function checkApproval(
	category: string,
	testName: string,
	input: string,
	output: string,
	skipApproval: boolean = false,
	useOpusApproval: boolean = false,
): Promise<ApprovalResult> {
	const categoryDir = getCategoryPath(category)

	const approvedMatch = findMatchingFile(categoryDir, testName, "approved", output)
	if (approvedMatch) {
		return { isApproved: true, newOutput: false }
	}

	const rejectedMatch = findMatchingFile(categoryDir, testName, "rejected", output)
	if (rejectedMatch) {
		return { isApproved: false, newOutput: false }
	}

	// If skipApproval is true, mark as unknown (new output)
	if (skipApproval) {
		return { isApproved: false, newOutput: true }
	}

	// Use Opus for auto-approval if enabled, otherwise ask user
	let isApproved: boolean
	if (useOpusApproval) {
		const previouslyApproved = getExistingOutputs(categoryDir, testName, "approved")
		const previouslyRejected = getExistingOutputs(categoryDir, testName, "rejected")
		isApproved = await askOpusApproval(input, output, previouslyApproved, previouslyRejected)
	} else {
		isApproved = await askUserApproval(category, testName, input, output)
	}

	const type: "approved" | "rejected" = isApproved ? "approved" : "rejected"

	fs.mkdirSync(categoryDir, { recursive: true })

	const nextNumber = getNextFileNumber(categoryDir, testName, type)
	const filename = `${testName}.${type}.${nextNumber}.txt`
	const filePath = path.join(categoryDir, filename)

	fs.writeFileSync(filePath, output, "utf-8")

	return { isApproved, newOutput: true }
}
