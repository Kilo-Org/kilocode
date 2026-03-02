import * as fs from "fs/promises"
import * as path from "path"
import type { BenchCheckpoint, BenchConfig, BenchProblemSet, BenchRunResult } from "./types.js"
import { DEFAULT_BENCH_CONFIG } from "./types.js"

function getBenchDir(cwd: string): string {
	return path.join(cwd, ".kilocode", "bench")
}

function getResultsDir(cwd: string): string {
	return path.join(getBenchDir(cwd), "results")
}

async function ensureDirExists(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true })
}

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object"
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((item) => typeof item === "string")
}

function isBenchRunResult(v: unknown): v is BenchRunResult {
	if (!isObject(v)) return false
	if (typeof v.id !== "string" || v.id.length === 0) return false
	if (typeof v.runAt !== "string" || v.runAt.length === 0) return false
	if (!isStringArray(v.models)) return false
	if (!Array.isArray(v.results)) return false
	if (!isObject(v.config)) return false
	if (!isObject(v.problemSet)) return false
	return Array.isArray(v.problemSet.problems)
}

function parseBenchRunResult(data: string): BenchRunResult | null {
	const parsed = JSON.parse(data) as unknown
	return isBenchRunResult(parsed) ? parsed : null
}

function isBenchCheckpoint(v: unknown): v is BenchCheckpoint {
	if (!isObject(v)) return false
	if (typeof v.runId !== "string" || v.runId.length === 0) return false
	if (typeof v.startedAt !== "string" || v.startedAt.length === 0) return false
	if (!isStringArray(v.models)) return false
	if (!isObject(v.problemSet) || !Array.isArray(v.problemSet.problems)) return false
	if (!isObject(v.config)) return false
	if (v.phase !== "running" && v.phase !== "evaluating") return false
	if (!Array.isArray(v.completedResponses)) return false
	if (!isObject(v.completedEvaluations)) return false
	return typeof v.interruptReason === "string"
}

function parseBenchCheckpoint(data: string): BenchCheckpoint | null {
	const parsed = JSON.parse(data) as unknown
	return isBenchCheckpoint(parsed) ? parsed : null
}

export async function loadConfig(cwd: string): Promise<BenchConfig> {
	const configPath = path.join(getBenchDir(cwd), "config.json")
	try {
		const data = await fs.readFile(configPath, "utf-8")
		const parsed = JSON.parse(data)
		return {
			...DEFAULT_BENCH_CONFIG,
			...parsed,
			weights: {
				...DEFAULT_BENCH_CONFIG.weights,
				...(parsed.weights || {}),
			},
		}
	} catch {
		return { ...DEFAULT_BENCH_CONFIG }
	}
}

export async function saveConfig(cwd: string, config: BenchConfig): Promise<void> {
	const dir = getBenchDir(cwd)
	await ensureDirExists(dir)
	await fs.writeFile(path.join(dir, "config.json"), JSON.stringify(config, null, 2), "utf-8")
}

export async function saveProblems(cwd: string, problems: BenchProblemSet): Promise<void> {
	const dir = getBenchDir(cwd)
	await ensureDirExists(dir)
	await fs.writeFile(path.join(dir, "problems.json"), JSON.stringify(problems, null, 2), "utf-8")
}

export async function loadProblems(cwd: string): Promise<BenchProblemSet | null> {
	const problemsPath = path.join(getBenchDir(cwd), "problems.json")
	try {
		const data = await fs.readFile(problemsPath, "utf-8")
		return JSON.parse(data)
	} catch {
		return null
	}
}

export async function saveRunResult(cwd: string, result: BenchRunResult): Promise<void> {
	const dir = getResultsDir(cwd)
	await ensureDirExists(dir)
	const safeId = result.id.replace(/[^a-zA-Z0-9_-]/g, "-") || "run"
	const filename = `${result.runAt.replace(/[:.]/g, "-")}-${safeId}.json`
	await fs.writeFile(path.join(dir, filename), JSON.stringify(result, null, 2), "utf-8")
}

export async function loadLatestResult(cwd: string): Promise<BenchRunResult | null> {
	const dir = getResultsDir(cwd)
	try {
		const files = await fs.readdir(dir)
		const jsonFiles = files
			.filter((f) => f.endsWith(".json"))
			.sort()
			.reverse()
		if (jsonFiles.length === 0) return null
		for (const file of jsonFiles) {
			try {
				const data = await fs.readFile(path.join(dir, file), "utf-8")
				const parsed = parseBenchRunResult(data)
				if (parsed) {
					return parsed
				}
			} catch {
				// Try next file
			}
		}
		return null
	} catch {
		return null
	}
}

export async function saveCheckpoint(cwd: string, checkpoint: BenchCheckpoint): Promise<void> {
	const dir = getBenchDir(cwd)
	await ensureDirExists(dir)
	await fs.writeFile(path.join(dir, "checkpoint.json"), JSON.stringify(checkpoint, null, 2), "utf-8")
}

export async function loadCheckpoint(cwd: string): Promise<BenchCheckpoint | null> {
	const checkpointPath = path.join(getBenchDir(cwd), "checkpoint.json")
	try {
		const data = await fs.readFile(checkpointPath, "utf-8")
		return parseBenchCheckpoint(data)
	} catch {
		return null
	}
}

export async function clearCheckpoint(cwd: string): Promise<void> {
	const checkpointPath = path.join(getBenchDir(cwd), "checkpoint.json")
	try {
		await fs.unlink(checkpointPath)
	} catch {
		// Already gone
	}
}

export async function loadAllResults(cwd: string): Promise<BenchRunResult[]> {
	const dir = getResultsDir(cwd)
	try {
		const files = await fs.readdir(dir)
		const jsonFiles = files
			.filter((f) => f.endsWith(".json"))
			.sort()
			.reverse()
		const results: BenchRunResult[] = []
		for (const file of jsonFiles) {
			try {
				const data = await fs.readFile(path.join(dir, file), "utf-8")
				const parsed = parseBenchRunResult(data)
				if (parsed) {
					results.push(parsed)
				}
			} catch {
				// Skip corrupted result files
			}
		}
		return results
	} catch {
		return []
	}
}
