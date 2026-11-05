/**
 * Worktree readiness: whether a project can hold worktrees, and the fixes when it can't.
 *
 * Entry-agnostic and VS Code-free. Callers pass a project root plus the few host
 * capabilities a step needs, so the New Worktree dialog and any other creation
 * path share one check.
 *
 * The check stops at the first problem, in this order: Git, repository, commits,
 * Git LFS. Git and Git LFS use the same caches creation uses, and a `fresh`
 * check bypasses both after an install or when the window regains focus.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { GitOps } from "./GitOps"
import { isRestrictedRoot } from "./home-workspace"
import { canonicalizePath, samePath } from "./project/paths"
import * as prepare from "./project/prepare"
import { errorText } from "./git-errors"
import type {
  Readiness,
  ReadinessInstaller,
  ReadinessMessage,
  ReadinessProject,
  FixReadinessRequest,
} from "../../webview-ui/src/types/messages/agent-manager"
import { codeForTool, isDownload, isInstall, toolFor } from "../shared/worktree-readiness"
import type { InstallOutcome, Tool, ToolProbe } from "./worktree-install"

type Git = Pick<GitOps, "execGit">

const MAX_PROJECT_CHOICES = 3
const PROBE = 16
const SCAN = 2000
const UNTRUSTED = "Trust this VS Code window before Kilo changes the project."
const RESTRICTED = "Choose a project folder, not your home folder or a filesystem root."

function ensureTrusted(deps: ReadinessDeps) {
  if (!deps.trusted()) throw new Error(UNTRUSTED)
}

function ensureAllowed(dir: string | undefined) {
  if (isRestrictedRoot(dir)) throw new Error(RESTRICTED)
}

export interface ReadinessTools {
  env(fresh: boolean): Promise<NodeJS.ProcessEnv | undefined>
  git(fresh: boolean, verify?: boolean, env?: NodeJS.ProcessEnv): Promise<ToolProbe>
  usesLfs(root: string): Promise<boolean>
  lfs(root: string, fresh: boolean, verify?: boolean, env?: NodeJS.ProcessEnv): Promise<ToolProbe>
  /** Whether git-lfs filters are registered for this repository (local, global, or system config). */
  lfsSetup(root: string): Promise<boolean>
  /** Run `git lfs install` for a repo whose filters are not registered. */
  setupLfs(root: string): Promise<number | undefined>
  installer(kind: Tool): Promise<ReadinessInstaller | undefined>
  install(kind: Tool, root: string): Promise<InstallOutcome>
  download(kind: Tool): void
}

export interface ReadinessDeps {
  git: Git
  trusted: () => boolean
  tools: ReadinessTools
  /** Injected for platform-specific probes in tests. */
  platform?: NodeJS.Platform
}

export interface FixDeps extends ReadinessDeps {
  /** Write Kilo's entries to the given repository's `.git/info/exclude`. */
  exclude: (root: string) => Promise<void>
  /** Open the repository in VS Code's Source Control view. */
  openRepository: (root: string) => void
  /** Post the given repository's refreshed branch list. */
  branches: (root: string) => Promise<void>
  /** Register a repository as a project and resolve its project ID. */
  attach: (root: string) => Promise<string>
  pick: () => Promise<string | undefined>
  /** The folder the user just picked through {@link pick}, until the next picked fix. */
  picked: () => string | undefined
  /** Remember a folder the user just picked. */
  remember: (root: string) => void
  /** Forget the remembered pick. */
  forget: () => void
}

export type FixOutcome = Omit<ReadinessMessage, "type" | "projectId" | "requestID">

/** One check per folder at a time; concurrent callers share it. A fresh check always bypasses it. */
const flight = new Map<string, Promise<Readiness>>()

export function checkWorktreeReadiness(
  root: string,
  deps: ReadinessDeps,
  fresh = false,
  verify = false,
): Promise<Readiness> {
  if (fresh || verify) return readReadiness(root, deps, fresh, verify)
  const key = canonicalizePath(root)
  const running = flight.get(key)
  if (running) return running
  const next = readReadiness(root, deps, false, false).finally(() => flight.delete(key))
  flight.set(key, next)
  return next
}

/** Run one fix, then re-check (bypassing any check in flight) and report the new state. */
export async function applyWorktreeFix(
  root: string,
  request: Pick<FixReadinessRequest, "fix" | "target" | "identity">,
  deps: FixDeps,
): Promise<FixOutcome> {
  const applied: FixResult = await runFix(root, request, deps).catch((err: unknown) => ({
    root,
    error: errorText(err),
  }))
  // A fresh check makes an install visible immediately; only a truly invisible tool stays stale.
  const probed = await readReadiness(applied.root, deps, applied.install !== undefined)
  const result = applied.picked && probed.status === "blocked" ? { ...probed, picked: true } : probed
  return {
    result: result.status === "ready" && applied.note ? { status: "ready", note: "uncommitted" } : result,
    ...(applied.selected ? { selected: applied.selected } : {}),
    ...(applied.error ? { error: applied.error } : {}),
    ...(applied.install ? { install: applied.install } : {}),
  }
}

type FixResult = {
  root: string
  selected?: string
  picked?: boolean
  note?: boolean
  install?: InstallOutcome
  error?: string
}

async function readReadiness(root: string, deps: ReadinessDeps, fresh = false, verify = false): Promise<Readiness> {
  return inspectProject(root, deps, fresh, verify).catch((err: unknown) => ({
    status: "unknown" as const,
    detail: errorText(err),
  }))
}

async function inspectProject(root: string, deps: ReadinessDeps, fresh: boolean, verify: boolean): Promise<Readiness> {
  const env = await deps.tools.env(fresh)
  const git = await deps.tools.git(fresh, verify, env)
  if (!git.ok) return blockedTool("git", git, root, deps)
  const state = await prepare.inspect(root, deps.git)
  if (isRestrictedRoot(state.root ?? root)) {
    return {
      status: "blocked",
      code: "not_git_repo",
      name: path.basename(state.root ?? root),
      trusted: deps.trusted(),
      restricted: true,
    }
  }
  if (!state.root) return projectChoices(root, deps)
  if (state.empty) {
    return {
      status: "blocked",
      code: "no_commits",
      name: path.basename(state.root),
      trusted: deps.trusted(),
      identity: await prepare.identity(state.root, deps.git),
    }
  }
  if (await deps.tools.usesLfs(state.root)) {
    const lfs = await deps.tools.lfs(state.root, fresh, verify, env)
    if (!lfs.ok) return blockedTool("lfs", lfs, state.root, deps)
    if (!(await deps.tools.lfsSetup(state.root)))
      return {
        status: "blocked",
        code: "lfs_not_setup",
        name: path.basename(state.root),
        trusted: deps.trusted(),
      }
  }
  return { status: "ready" }
}

/** A confirmed missing tool becomes a blocker; any other probe failure stays advisory. */
async function blockedTool(
  kind: Tool,
  failure: Extract<ToolProbe, { ok: false }>,
  root: string,
  deps: ReadinessDeps,
): Promise<Readiness> {
  if (failure.code === "unknown") return { status: "unknown", detail: failure.detail }
  return {
    status: "blocked",
    code: kind === "git" ? "git_not_found" : "lfs_missing",
    name: path.basename(root),
    trusted: deps.trusted(),
    platform: deps.platform ?? process.platform,
    installer: await deps.tools.installer(kind),
  }
}

/** A folder that is not a Git project: offer the projects inside it, or setting up Git. */
async function projectChoices(root: string, deps: ReadinessDeps): Promise<Readiness> {
  const base = { status: "blocked" as const, code: "not_git_repo" as const, name: path.basename(root) }
  const { projects: found, truncated } = await childProjects(root)
  if (found.length > 0) {
    return {
      ...base,
      trusted: deps.trusted(),
      projects: found.slice(0, MAX_PROJECT_CHOICES),
      ...(found.length > MAX_PROJECT_CHOICES || truncated ? { more: true } : {}),
    }
  }
  return { ...base, trusted: deps.trusted(), identity: await prepare.identity(root, deps.git) }
}

/** Direct child folders that contain `.git`, probed with bounded concurrency. */
async function childProjects(root: string): Promise<{ projects: ReadinessProject[]; truncated: boolean }> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const scanned = dirs.slice(0, SCAN)
  const found: ReadinessProject[] = []
  let index = 0
  const worker = async () => {
    while (found.length <= MAX_PROJECT_CHOICES && index < scanned.length) {
      const name = scanned[index++]!
      const dir = path.join(root, name)
      if (await fileExists(path.join(dir, ".git"))) found.push({ root: dir, label: name })
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE, scanned.length) }, worker))
  return { projects: found.sort((a, b) => a.label.localeCompare(b.label)), truncated: dirs.length > SCAN }
}

function fileExists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

async function runFix(
  root: string,
  request: Pick<FixReadinessRequest, "fix" | "target" | "identity">,
  deps: FixDeps,
): Promise<FixResult> {
  const toolFix = await runToolFix(root, request, deps)
  if (toolFix) return toolFix
  ensureTrusted(deps)
  if (request.fix === "useProject") return nested(root, request.target, deps)
  if (request.fix === "pickFolder") return choose(root, deps)
  if (request.fix !== "initGit" && request.fix !== "initialCommit")
    throw new Error(`Unknown readiness fix: ${String(request.fix)}`)
  if (request.target !== undefined) return usePick(request.target, request, deps)
  const done = await setup(root, request, deps)
  deps.openRepository(done.repo)
  await deps.branches(done.repo)
  return { root, note: done.note }
}

/** Initialize, exclude, configure identity and commit; returns the repository and uncommitted note. */
async function setup(
  root: string,
  request: Pick<FixReadinessRequest, "fix" | "identity">,
  deps: FixDeps,
  inspected?: Awaited<ReturnType<typeof prepare.inspect>>,
): Promise<{ repo: string; note: boolean }> {
  const state = inspected ?? (await prepare.inspect(root, deps.git))
  ensureAllowed(state.root ?? root)
  if (request.fix === "initialCommit" && !state.root) throw new Error(`Not a Git repository: ${root}`)
  if (!request.identity && !(await prepare.identity(root, deps.git)))
    throw new Error("Git needs a name and email before Kilo can create the first commit.")
  ensureTrusted(deps)
  const repo = state.root ?? (await prepare.initialize(root, deps.git))
  ensureTrusted(deps)
  await deps.exclude(repo)
  ensureTrusted(deps)
  if (request.identity) await prepare.configure(repo, deps.git, request.identity)
  ensureTrusted(deps)
  await prepare.commit(repo, deps.git)
  const status = await deps.git.execGit(["-c", "core.fsmonitor=false", "status", "--porcelain"], repo)
  return { repo, note: status.code === 0 && status.stdout.trim().length > 0 }
}

/** Downloads and installs need no repository inspection. */
async function runToolFix(
  root: string,
  request: Pick<FixReadinessRequest, "fix">,
  deps: FixDeps,
): Promise<FixResult | undefined> {
  if (request.fix === "setupLfs") {
    ensureTrusted(deps)
    const exit = await deps.tools.setupLfs(root)
    if (exit === undefined) return { root, error: "Set up Git LFS was stopped. See the terminal output." }
    if (exit !== 0) return { root, error: `Set up Git LFS exited with code ${exit}. See the terminal output.` }
    return { root }
  }
  const tool = toolFor(request.fix)
  if (!tool) return undefined
  if (isDownload(request.fix)) {
    deps.tools.download(tool)
    return { root }
  }
  ensureTrusted(deps)
  return { root, install: await deps.tools.install(tool, root) }
}

/** Select a Git project nested directly inside the current folder. */
async function nested(root: string, value: string | undefined, deps: FixDeps): Promise<FixResult> {
  const target = value ? canonicalizePath(value) : ""
  const parent = deps.picked()
  const inside = (base: string | undefined) => base !== undefined && samePath(path.dirname(target), base)
  if (!target || (!inside(root) && !inside(parent)) || !(await fileExists(path.join(target, ".git"))))
    throw new Error(`Not a Git project inside ${root}: ${value ?? ""}`)
  const done = await registerProject(target, deps)
  deps.forget()
  return done
}

/** Use the folder the user just picked: attach it when it is a repository, otherwise remember it for setup. */
async function choose(root: string, deps: FixDeps): Promise<FixResult> {
  const dir = await deps.pick()
  if (!dir) return { root }
  const state = await prepare.inspect(dir, deps.git)
  const picked = state.root ?? canonicalizePath(dir)
  ensureAllowed(picked)
  ensureTrusted(deps)
  if (state.root) {
    deps.forget()
    return { root: picked, selected: await deps.attach(picked) }
  }
  deps.remember(picked)
  return { root: picked, picked: true }
}

/** Set up Git in the folder the user just picked, then attach and select it. */
async function usePick(
  value: string,
  request: Pick<FixReadinessRequest, "fix" | "identity">,
  deps: FixDeps,
): Promise<FixResult> {
  const remembered = deps.picked()
  const target = value === "picked" ? remembered : canonicalizePath(value)
  if (!remembered || !target || !samePath(target, remembered)) {
    deps.forget()
    throw new Error("That folder is no longer the one you picked. Pick it again.")
  }
  ensureAllowed(remembered)
  ensureTrusted(deps)
  const state = await prepare.inspect(remembered, deps.git)
  if (state.root && !samePath(state.root, remembered)) {
    deps.forget()
    throw new Error("That folder is inside another Git repository now. Pick it again.")
  }
  deps.forget()
  const done = await setup(remembered, request, deps, state)
  deps.openRepository(done.repo)
  const selected = await deps.attach(done.repo)
  await deps.branches(done.repo)
  return { root: done.repo, selected, note: done.note }
}

/** Register a repository as a project and select it. A non-repository folder is not attached yet. */
async function registerProject(dir: string, deps: FixDeps): Promise<FixResult> {
  const state = await prepare.inspect(dir, deps.git)
  const root = state.root ?? canonicalizePath(dir)
  ensureAllowed(root)
  ensureTrusted(deps)
  if (!state.root) return { root }
  return { root, selected: await deps.attach(root) }
}
