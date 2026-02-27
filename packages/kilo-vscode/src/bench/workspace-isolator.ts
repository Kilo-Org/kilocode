import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as crypto from "crypto"
import simpleGit, { type SimpleGit } from "simple-git"

export type IsolationStrategy = "worktree" | "init-worktree" | "fs-copy"

export interface WorkspaceIsolator {
	readonly strategy: IsolationStrategy
	readonly isolatedDir: string
	captureDiff(): Promise<string>
	reset(): Promise<void>
	cleanup(): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function createWorkspaceIsolator(
	cwd: string,
	label: string,
	log?: (msg: string) => void,
): Promise<WorkspaceIsolator> {
	const logger = log ?? console.log

	// Tier 1: existing git repo → worktree
	try {
		const git = simpleGit(cwd)
		const isRepo = await git.checkIsRepo()
		if (isRepo) {
			logger(`[Kilo Bench] Using worktree isolation (existing git repo)`)
			return createWorktreeIsolator(cwd, label, "worktree", logger)
		}
	} catch {
		// not a repo
	}

	// Tier 2: git available → copy + git init + worktree
	try {
		await simpleGit().version()
		logger(`[Kilo Bench] Using init-worktree isolation (git available, not a repo)`)
		return createWorktreeIsolator(cwd, label, "init-worktree", logger)
	} catch {
		// git not available
	}

	// Tier 3: fs.cp fallback
	logger(`[Kilo Bench] Using fs-copy isolation (no git available)`)
	return createFsCopyIsolator(cwd, label, logger)
}

// ---------------------------------------------------------------------------
// Worktree isolator (tiers 1 & 2)
// ---------------------------------------------------------------------------

async function createWorktreeIsolator(
	cwd: string,
	label: string,
	strategy: "worktree" | "init-worktree",
	log: (msg: string) => void,
): Promise<WorkspaceIsolator> {
	let repoRoot = cwd
	let tempRepoDir: string | undefined

	if (strategy === "init-worktree") {
		// Copy workspace to a temp directory and initialise a git repo
		const tmpBase = path.join(os.tmpdir(), "kilo-bench")
		await fs.mkdir(tmpBase, { recursive: true })
		tempRepoDir = path.join(tmpBase, `repo-${Date.now()}`)
		await fs.cp(cwd, tempRepoDir, { recursive: true, filter: createCopyFilter(cwd) })

		const tmpGit = simpleGit(tempRepoDir)
		await tmpGit.init()
		await tmpGit.add("-A")
		await tmpGit.commit("bench: initial snapshot")
		repoRoot = tempRepoDir
		log(`[Kilo Bench] Created temp git repo at ${tempRepoDir}`)
	}

	const git = simpleGit(repoRoot)
	const baseBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim()
	const safeName = label.replace(/[^a-zA-Z0-9_-]/g, "-")
	const uid = crypto.randomBytes(3).toString("hex")
	const branchName = `kilo-bench/${safeName}-${uid}`

	const worktreeBase = path.join(os.tmpdir(), "kilo-bench", "worktrees")
	await fs.mkdir(worktreeBase, { recursive: true })
	const worktreeDir = path.join(worktreeBase, `${safeName}-${uid}`)

	// Clean up leftover from prior crash
	if (await exists(worktreeDir)) {
		await git.raw(["worktree", "remove", "--force", worktreeDir]).catch(() => {})
		await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => {})
	}

	await git.raw(["worktree", "add", "-b", branchName, worktreeDir, baseBranch])
	log(`[Kilo Bench] Created worktree at ${worktreeDir} (branch: ${branchName})`)

	return new WorktreeIsolatorImpl(strategy, worktreeDir, repoRoot, branchName, tempRepoDir, log)
}

class WorktreeIsolatorImpl implements WorkspaceIsolator {
	readonly strategy: IsolationStrategy
	readonly isolatedDir: string
	private repoRoot: string
	private branchName: string
	private tempRepoDir?: string
	private log: (msg: string) => void

	constructor(
		strategy: IsolationStrategy,
		isolatedDir: string,
		repoRoot: string,
		branchName: string,
		tempRepoDir: string | undefined,
		log: (msg: string) => void,
	) {
		this.strategy = strategy
		this.isolatedDir = isolatedDir
		this.repoRoot = repoRoot
		this.branchName = branchName
		this.tempRepoDir = tempRepoDir
		this.log = log
	}

	async captureDiff(): Promise<string> {
		const wtGit = simpleGit(this.isolatedDir)
		await wtGit.add("-A")
		const diff = await wtGit.diff(["--cached"])
		return diff || "(no changes detected)"
	}

	async reset(): Promise<void> {
		const wtGit = simpleGit(this.isolatedDir)
		await wtGit.reset(["--hard", "HEAD"])
		await wtGit.clean("f", ["-d"])
	}

	async cleanup(): Promise<void> {
		const rootGit = simpleGit(this.repoRoot)

		try {
			await rootGit.raw(["worktree", "remove", "--force", this.isolatedDir])
		} catch {
			await fs.rm(this.isolatedDir, { recursive: true, force: true }).catch(() => {})
		}

		try {
			await rootGit.raw(["branch", "-D", this.branchName])
		} catch {
			// best effort
		}

		if (this.tempRepoDir) {
			await fs.rm(this.tempRepoDir, { recursive: true, force: true }).catch(() => {})
			this.log(`[Kilo Bench] Removed temp repo ${this.tempRepoDir}`)
		}

		this.log(`[Kilo Bench] Cleaned up worktree ${this.isolatedDir}`)
	}
}

// ---------------------------------------------------------------------------
// FS-copy isolator (tier 3)
// ---------------------------------------------------------------------------

async function createFsCopyIsolator(
	cwd: string,
	label: string,
	log: (msg: string) => void,
): Promise<WorkspaceIsolator> {
	const tmpBase = path.join(os.tmpdir(), "kilo-bench")
	await fs.mkdir(tmpBase, { recursive: true })
	const safeName = label.replace(/[^a-zA-Z0-9_-]/g, "-")
	const uid = crypto.randomBytes(3).toString("hex")
	const snapshotDir = path.join(tmpBase, `snapshot-${safeName}-${uid}`)
	const workDir = path.join(tmpBase, `work-${safeName}-${uid}`)

	await fs.cp(cwd, snapshotDir, { recursive: true, filter: createCopyFilter(cwd) })
	await fs.cp(cwd, workDir, { recursive: true, filter: createCopyFilter(cwd) })
	log(`[Kilo Bench] Created fs-copy isolation at ${workDir}`)

	return new FsCopyIsolatorImpl(workDir, snapshotDir, log)
}

class FsCopyIsolatorImpl implements WorkspaceIsolator {
	readonly strategy: IsolationStrategy = "fs-copy"
	readonly isolatedDir: string
	private snapshotDir: string
	private log: (msg: string) => void

	constructor(isolatedDir: string, snapshotDir: string, log: (msg: string) => void) {
		this.isolatedDir = isolatedDir
		this.snapshotDir = snapshotDir
		this.log = log
	}

	async captureDiff(): Promise<string> {
		return generateFsDiffSummary(this.snapshotDir, this.isolatedDir)
	}

	async reset(): Promise<void> {
		await fs.rm(this.isolatedDir, { recursive: true, force: true })
		await fs.cp(this.snapshotDir, this.isolatedDir, {
			recursive: true,
			filter: createCopyFilter(this.snapshotDir),
		})
	}

	async cleanup(): Promise<void> {
		await fs.rm(this.isolatedDir, { recursive: true, force: true }).catch(() => {})
		await fs.rm(this.snapshotDir, { recursive: true, force: true }).catch(() => {})
		this.log(`[Kilo Bench] Cleaned up fs-copy isolation`)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p)
		return true
	} catch {
		return false
	}
}

const IGNORE_DIRS = new Set([
	"node_modules", ".git", ".kilocode", "dist", "build",
	"__pycache__", ".next", ".vscode", "coverage", "vendor", "target",
])

function createCopyFilter(root: string): (source: string) => boolean {
	return (source: string) => {
		const rel = path.relative(root, source)
		if (!rel || rel === ".") {
			return true
		}
		return !rel.split(path.sep).some((segment) => IGNORE_DIRS.has(segment))
	}
}

async function collectFiles(dir: string, base: string): Promise<Map<string, string>> {
	const files = new Map<string, string>()

	async function walk(current: string) {
		let entries
		try {
			entries = await fs.readdir(current, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
					await walk(path.join(current, entry.name))
				}
			} else if (entry.isFile()) {
				const fullPath = path.join(current, entry.name)
				const relPath = path.relative(base, fullPath)
				try {
					const content = await fs.readFile(fullPath, "utf-8")
					files.set(relPath, content)
				} catch {
					files.set(relPath, "(binary or unreadable)")
				}
			}
		}
	}

	await walk(dir)
	return files
}

async function generateFsDiffSummary(snapshotDir: string, workDir: string): Promise<string> {
	const original = await collectFiles(snapshotDir, snapshotDir)
	const modified = await collectFiles(workDir, workDir)

	const added: string[] = []
	const removed: string[] = []
	const changed: string[] = []

	for (const [file] of modified) {
		if (!original.has(file)) {
			added.push(file)
		} else if (original.get(file) !== modified.get(file)) {
			changed.push(file)
		}
	}
	for (const [file] of original) {
		if (!modified.has(file)) {
			removed.push(file)
		}
	}

	if (added.length === 0 && removed.length === 0 && changed.length === 0) {
		return "(no changes detected)"
	}

	const lines: string[] = []
	if (added.length > 0) lines.push(`Added files:\n${added.map((f) => `  + ${f}`).join("\n")}`)
	if (removed.length > 0) lines.push(`Removed files:\n${removed.map((f) => `  - ${f}`).join("\n")}`)
	if (changed.length > 0) lines.push(`Modified files:\n${changed.map((f) => `  ~ ${f}`).join("\n")}`)

	return lines.join("\n\n")
}
