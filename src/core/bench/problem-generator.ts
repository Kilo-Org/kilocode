// kilocode_change - new file
import * as fs from "fs/promises"
import * as path from "path"

import type { ProviderSettings } from "@roo-code/types"

import { buildApiHandler } from "../../api"
import type { BenchConfig, BenchMode, BenchProblem, BenchProblemSet } from "./types"

async function readWorkspaceSummary(cwd: string): Promise<{
	language: string
	summary: string
	keyFiles: string[]
}> {
	let language = "unknown"
	const keyFiles: string[] = []
	const summaryParts: string[] = []

	// Detect language from common config files
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
				summaryParts.push(`--- ${file} ---\n${content.slice(0, 2000)}`)
			} catch {
				// ignore read errors
			}
			break
		} catch {
			// file doesn't exist, continue
		}
	}

	// Read directory tree (top 3 levels)
	const tree = await buildFileTree(cwd, 3)
	summaryParts.unshift(`File tree:\n${tree}`)

	// Find key source files by size
	const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php"]
	const sourceFiles = await findSourceFiles(cwd, sourceExtensions, 2)
	for (const file of sourceFiles.slice(0, 3)) {
		try {
			const content = await fs.readFile(file, "utf-8")
			const relativePath = path.relative(cwd, file)
			keyFiles.push(relativePath)
			summaryParts.push(`--- ${relativePath} ---\n${content.slice(0, 3000)}`)
		} catch {
			// ignore
		}
	}

	return {
		language,
		summary: summaryParts.join("\n\n"),
		keyFiles,
	}
}

async function buildFileTree(dir: string, maxDepth: number, depth = 0, prefix = ""): Promise<string> {
	if (depth >= maxDepth) return ""

	const ignoreDirs = new Set([
		"node_modules",
		".git",
		".kilocode",
		"dist",
		"build",
		"__pycache__",
		".next",
		".vscode",
		"coverage",
		"vendor",
		"target",
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

${
	activeModes.includes("architect")
		? `**Architect Mode** (planning, system design, no code modification):
Generate problems that test architectural reasoning, system design, and understanding of existing patterns. The model should plan but NOT write implementation code.

`
		: ""
}${
		activeModes.includes("code")
			? `**Code Mode** (implementation, code generation, file modification):
Generate problems that test code generation, implementation quality, and style consistency with the existing codebase. Include specific functions or features to implement.

`
			: ""
	}${
		activeModes.includes("debug")
			? `**Debug Mode** (bug diagnosis, root cause analysis, fixes):
Generate problems that describe a realistic bug scenario in this codebase. Include symptoms, affected files, and expected behavior. The model should diagnose and fix.

`
			: ""
	}${
		activeModes.includes("ask")
			? `**Ask Mode** (comprehension, explanation, analysis):
Generate problems that test understanding of the codebase — how modules connect, what the data flow is, potential security concerns, performance bottlenecks.

`
			: ""
	}${
		activeModes.includes("orchestrator")
			? `**Orchestrator Mode** (multi-step coordination, task decomposition):
Generate problems that require breaking a complex task into subtasks across multiple modes. Test the model's ability to plan and coordinate multi-step work.

`
			: ""
	}For each problem, provide:
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
	providerSettings: ProviderSettings,
	abortSignal?: AbortSignal,
): Promise<BenchProblemSet> {
	const { language, summary, keyFiles: _keyFiles } = await readWorkspaceSummary(cwd)

	const prompt = buildGeneratorPrompt(language, summary, config.activeModes, config.problemsPerMode)

	const handler = buildApiHandler(providerSettings)
	const { id: modelId } = handler.getModel()

	const messages: { role: "user"; content: string }[] = [{ role: "user", content: prompt }]

	const stream = handler.createMessage("You are a benchmark problem generator. Output only valid JSON.", messages)

	let responseText = ""
	for await (const chunk of stream) {
		if (abortSignal?.aborted) {
			throw new Error("Benchmark generation cancelled")
		}
		if (chunk.type === "text") {
			responseText += chunk.text
		}
	}

	// Extract JSON from response (handle markdown code blocks)
	const jsonMatch = responseText.match(/\{[\s\S]*\}/)
	if (!jsonMatch) {
		throw new Error("Generator model did not return valid JSON")
	}

	const parsed = JSON.parse(jsonMatch[0])
	const problems: BenchProblem[] = (parsed.problems || []).map(
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
			mode: p.mode as BenchMode,
			title: p.title,
			prompt: p.prompt,
			contextFiles: p.context_files || [],
			evaluationCriteria: p.evaluation_criteria || [],
			difficulty: (p.difficulty as "easy" | "medium" | "hard") || "medium",
		}),
	)

	return {
		version: "1.0.0",
		generatedAt: new Date().toISOString(),
		generatorModel: modelId,
		workspacePath: cwd,
		workspaceSummary: `${language} codebase`,
		problems,
	}
}
