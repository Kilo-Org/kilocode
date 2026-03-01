import * as fs from "fs/promises"
import * as path from "path"

import { BENCH_MODES } from "./types.js"
import type { BenchApiHandler, BenchConfig, BenchMode, BenchProblem, BenchProblemSet } from "./types.js"

const SENSITIVE_KEYS = new Set([
	"token",
	"secret",
	"password",
	"apikey",
	"api_key",
	"auth",
	"authorization",
	"scripts",
	"publishconfig",
	"env",
	"environment",
])

function redactText(value: string): string {
	const withRedactedAuth = value.replace(/https?:\/\/[^/\s:@]+:[^@\s/]+@/g, "https://[REDACTED]@")
	return withRedactedAuth.replace(/(ghp_[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/g, "[REDACTED]")
}

function redactJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => redactJsonValue(entry))
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value)) {
			const lower = k.toLowerCase()
			const isSensitive = SENSITIVE_KEYS.has(lower) ||
				lower.includes("token") ||
				lower.includes("secret") ||
				lower.includes("password")
			out[k] = isSensitive ? "[REDACTED]" : redactJsonValue(v)
		}
		return out
	}
	if (typeof value === "string") {
		return redactText(value)
	}
	return value
}

function sanitizeSummaryFile(file: string, content: string): string {
	const isJson = file.endsWith(".json")
	if (!isJson) {
		return redactText(content).slice(0, 2000)
	}
	try {
		const parsed = JSON.parse(content) as unknown
		const redacted = redactJsonValue(parsed)
		return JSON.stringify(redacted, null, 2).slice(0, 2000)
	} catch {
		return redactText(content).slice(0, 2000)
	}
}

async function readWorkspaceSummary(cwd: string): Promise<{
	language: string
	summary: string
	keyFiles: string[]
}> {
	let language = "unknown"
	const keyFiles: string[] = []
	const summaryParts: string[] = []

	const langDetectors: [string, string][] = [
		["package.json", "TypeScript/JavaScript"],
		["tsconfig.json", "TypeScript"],
		["requirements.txt", "Python"],
		["go.mod", "Go"],
		["Cargo.toml", "Rust"],
		["pom.xml", "Java"],
		["build.gradle", "Java/Kotlin"],
		["Gemfile", "Ruby"],
		["composer.json", "PHP"],
	]

	for (const [file, lang] of langDetectors) {
		try {
			await fs.access(path.join(cwd, file))
			language = lang
			try {
				const content = await fs.readFile(path.join(cwd, file), "utf-8")
				summaryParts.push(`--- ${file} ---\n${sanitizeSummaryFile(file, content)}`)
			} catch {
				// ignore read errors
			}
			break
		} catch {
			// file doesn't exist
		}
	}

	const tree = await buildFileTree(cwd, 3)
	summaryParts.unshift(`File tree:\n${tree}`)

	const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php"]
	const sourceFiles = await findSourceFiles(cwd, sourceExtensions, 2)
	for (const file of sourceFiles.slice(0, 3)) {
		try {
			const content = await fs.readFile(file, "utf-8")
			const relativePath = path.relative(cwd, file)
			keyFiles.push(relativePath)
			summaryParts.push(`--- ${relativePath} ---\n${redactText(content.slice(0, 3000))}`)
		} catch {
			// ignore
		}
	}

	return { language, summary: summaryParts.join("\n\n"), keyFiles }
}

async function buildFileTree(dir: string, maxDepth: number, depth = 0, prefix = ""): Promise<string> {
	if (depth >= maxDepth) return ""

	const ignoreDirs = new Set([
		"node_modules", ".git", ".kilocode", "dist", "build",
		"__pycache__", ".next", ".vscode", "coverage", "vendor", "target",
	])

	let result = ""
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		const filtered = entries
			.filter((e) => !e.name.startsWith(".") || e.name === ".kilocode")
			.filter((e) => !(e.isDirectory() && ignoreDirs.has(e.name)))
			.slice(0, 30)

		for (const entry of filtered) {
			result += `${prefix}${entry.isDirectory() ? entry.name + "/" : entry.name}\n`
			if (entry.isDirectory()) {
				result += await buildFileTree(path.join(dir, entry.name), maxDepth, depth + 1, prefix + "  ")
			}
		}
	} catch {
		// ignore
	}
	return result
}

async function findSourceFiles(dir: string, extensions: string[], maxDepth: number): Promise<string[]> {
	const files: { path: string; size: number }[] = []

	async function walk(currentDir: string, depth: number) {
		if (depth > maxDepth) return
		const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next", "vendor"])
		try {
			const entries = await fs.readdir(currentDir, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = path.join(currentDir, entry.name)
				if (entry.isDirectory() && !ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
					await walk(fullPath, depth + 1)
				} else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
					try {
						const stat = await fs.stat(fullPath)
						files.push({ path: fullPath, size: stat.size })
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// ignore
		}
	}

	await walk(dir, 0)
	files.sort((a, b) => b.size - a.size)
	return files.map((f) => f.path)
}

function buildGeneratorPrompt(
	language: string,
	workspaceSummary: string,
	activeModes: BenchMode[],
	problemsPerMode: number,
): string {
	return `You are generating benchmark problems for the Kilo Code AI coding assistant.
You are analyzing a ${language} codebase:

${workspaceSummary}

Generate exactly ${problemsPerMode} problems for each of the following Kilo modes:

${activeModes.includes("architect") ? `**Architect Mode** (planning, system design, no code modification):
Generate problems that test architectural reasoning, system design, and understanding of existing patterns. The model should plan but NOT write implementation code.

` : ""}${activeModes.includes("code") ? `**Code Mode** (implementation, code generation, file modification):
Generate problems that test code generation, implementation quality, and style consistency with the existing codebase. Include specific functions or features to implement.

` : ""}${activeModes.includes("debug") ? `**Debug Mode** (bug diagnosis, root cause analysis, fixes):
Generate problems that describe a realistic bug scenario in this codebase. Include symptoms, affected files, and expected behavior. The model should diagnose and fix.

` : ""}${activeModes.includes("ask") ? `**Ask Mode** (comprehension, explanation, analysis):
Generate problems that test understanding of the codebase — how modules connect, what the data flow is, potential security concerns, performance bottlenecks.

` : ""}${activeModes.includes("orchestrator") ? `**Orchestrator Mode** (multi-step coordination, task decomposition):
Generate problems that require breaking a complex task into subtasks across multiple modes. Test the model's ability to plan and coordinate multi-step work.

` : ""}For each problem, provide:
- title: Short descriptive title
- prompt: The exact prompt to send to the model (as if a developer typed it into Kilo)
- context_files: Array of file paths from the workspace that should be included as context
- evaluation_criteria: Array of 3-5 specific things a good response MUST include
- difficulty: "easy" | "medium" | "hard"

Respond ONLY with valid JSON matching this structure:
{
  "problems": [
    {
      "id": "architect-001",
      "mode": "architect",
      "title": "...",
      "prompt": "...",
      "context_files": ["..."],
      "evaluation_criteria": ["..."],
      "difficulty": "medium"
    }
  ]
}`
}

export async function generateProblems(
	cwd: string,
	config: BenchConfig,
	apiHandler: BenchApiHandler,
	abortSignal?: AbortSignal,
): Promise<BenchProblemSet> {
	const { language, summary } = await readWorkspaceSummary(cwd)
	const activeModes = config.activeModes.length > 0 ? config.activeModes : [...BENCH_MODES]
	const problemsPerMode = Math.max(1, Math.min(10, config.problemsPerMode))

	const prompt = buildGeneratorPrompt(language, summary, activeModes, problemsPerMode)
	const modelId = apiHandler.getModelId()

	const stream = apiHandler.createMessage(
		"You are a benchmark problem generator. Output only valid JSON.",
		prompt,
	)

	let responseText = ""
	for await (const chunk of stream) {
		if (abortSignal?.aborted) {
			throw new Error("Benchmark generation cancelled")
		}
		if (chunk.type === "text") {
			responseText += chunk.text
		}
	}

	const parsed = extractJSON(responseText)
	if (!parsed) {
		// Retry once — the model sometimes needs a second attempt
		const retryStream = apiHandler.createMessage(
			"You are a benchmark problem generator. Output ONLY valid JSON with no markdown, no code fences, no extra text. Start your response with { and end with }.",
			prompt,
		)
		let retryText = ""
		for await (const chunk of retryStream) {
			if (abortSignal?.aborted) {
				throw new Error("Benchmark generation cancelled")
			}
			if (chunk.type === "text") {
				retryText += chunk.text
			}
		}
		const retryParsed = extractJSON(retryText)
		if (!retryParsed) {
			const preview = (retryText || responseText).slice(0, 200) || "(empty response)"
			throw new Error(`Generator model did not return valid JSON after retry. Response preview: ${preview}`)
		}
		return buildProblemSet(retryParsed, language, modelId)
	}

	return buildProblemSet(parsed, language, modelId)
}

/** Try multiple strategies to extract JSON from model output */
function extractJSON(text: string): any | null {
	// Strip markdown code fences if present
	const stripped = text
		.replace(/^```(?:json)?\s*\n?/gm, "")
		.replace(/\n?```\s*$/gm, "")
		.trim()

	// Strategy 1: Try parsing the whole stripped text
	try {
		const parsed = JSON.parse(stripped)
		if (parsed && typeof parsed === "object") return parsed
	} catch {
		// continue
	}

	// Strategy 2: Find outermost { ... } with greedy match
	const match = stripped.match(/\{[\s\S]*\}/)
	if (match) {
		try {
			return JSON.parse(match[0])
		} catch {
			// continue
		}
	}

	// Strategy 3: Find the first { and try to parse from there
	const firstBrace = text.indexOf("{")
	if (firstBrace >= 0) {
		const candidate = text.slice(firstBrace)
		try {
			return JSON.parse(candidate)
		} catch {
			// Try trimming trailing non-JSON content
			const lastBrace = candidate.lastIndexOf("}")
			if (lastBrace > 0) {
				try {
					return JSON.parse(candidate.slice(0, lastBrace + 1))
				} catch {
					// give up
				}
			}
		}
	}

	return null
}

function buildProblemSet(parsed: any, language: string, modelId: string): BenchProblemSet {
	if (!parsed.problems || !Array.isArray(parsed.problems)) {
		throw new Error("Generator model response missing 'problems' array")
	}

	const problems: BenchProblem[] = parsed.problems
		.filter(
			(p: any) =>
				p !== null &&
				p !== undefined &&
				typeof p.id === "string" &&
				p.id.length > 0 &&
				typeof p.prompt === "string" &&
				p.prompt.length > 0,
		)
			.map(
				(p: {
					id: string
					mode: string
					title: string
					prompt: string
					context_files?: string[]
					evaluation_criteria?: string[]
					difficulty?: string
				}) => ({
					id: p.id,
					mode: BENCH_MODES.includes(p.mode as BenchMode) ? (p.mode as BenchMode) : "code",
					title: p.title || p.id,
					prompt: p.prompt,
					contextFiles: Array.isArray(p.context_files)
						? p.context_files.filter((f): f is string => typeof f === "string")
						: [],
					evaluationCriteria: Array.isArray(p.evaluation_criteria)
						? p.evaluation_criteria.filter((c): c is string => typeof c === "string")
						: [],
					difficulty: p.difficulty === "easy" || p.difficulty === "medium" || p.difficulty === "hard"
						? p.difficulty
						: "medium",
				}),
			)

	if (problems.length === 0) {
		throw new Error("Generator model produced no valid problems")
	}

	return {
		version: "1.0.0",
		generatedAt: new Date().toISOString(),
		generatorModel: modelId,
		workspacePath: ".",
		workspaceSummary: `${language} codebase`,
		problems,
	}
}
