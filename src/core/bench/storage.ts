// kilocode_change - new file
import * as fs from "fs/promises"
import * as path from "path"
import type { BenchConfig, BenchProblemSet, BenchRunResult } from "./types"
import { DEFAULT_BENCH_CONFIG } from "./types"

function getBenchDir(cwd: string): string {
	return path.join(cwd, ".kilocode", "bench")
}

function getResultsDir(cwd: string): string {
	return path.join(getBenchDir(cwd), "results")
}

async function ensureDirExists(dirPath: string): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true })
}

export async function loadConfig(cwd: string): Promise<BenchConfig> {
	const configPath = path.join(getBenchDir(cwd), "config.json")
	try {
		const data = await fs.readFile(configPath, "utf-8")
		return { ...DEFAULT_BENCH_CONFIG, ...JSON.parse(data) }
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
	const filename = `${result.runAt.replace(/[:.]/g, "-")}.json`
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
		const data = await fs.readFile(path.join(dir, jsonFiles[0]), "utf-8")
		return JSON.parse(data)
	} catch {
		return null
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
			const data = await fs.readFile(path.join(dir, file), "utf-8")
			results.push(JSON.parse(data))
		}
		return results
	} catch {
		return []
	}
}
