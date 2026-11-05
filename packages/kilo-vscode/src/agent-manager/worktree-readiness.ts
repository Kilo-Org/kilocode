/**
 * Worktree readiness: whether a project can hold worktrees, and the fixes when it can't.
 *
 * Entry-agnostic and VS Code-free. Callers pass a project root plus the few host
 * capabilities a step needs, so the New Worktree dialog and any other creation
 * path share one check.
 *
 * The check stops at the first problem, in this order: Git, repository, commits,
 * Git LFS. The repository and commit steps live here; Git and Git LFS are not
 * checked yet, so a missing Git surfaces as `unknown` and never blocks.
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { GitOps } from "./GitOps"
import { isRestrictedRoot } from "./home-workspace"
import { canonicalizePath, samePath } from "./project/paths"
import * as prepare from "./project/prepare"
import type {
  Readiness,
  ReadinessProject,
  FixReadinessRequest,
} from "../../webview-ui/src/types/messages/agent-manager"

type Git = Pick<GitOps, "execGit">

const LIMIT = 3
const PROBE = 16
const SCAN = 2000
const UNTRUSTED = "Trust this VS Code window before Kilo changes the project."
const RESTRICTED = "Choose a project folder, not your home folder or a filesystem root."

function trust(deps: ReadinessDeps) {
  if (!deps.trusted()) throw new Error(UNTRUSTED)
}

function allow(dir: string | undefined) {
  if (isRestrictedRoot(dir)) throw new Error(RESTRICTED)
}

export interface ReadinessDeps {
  git: Git
  trusted: () => boolean
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
  /** Ask for a folder; undefined when cancelled. */
  pick: () => Promise<string | undefined>
  /** The folder the user just picked through {@link pick}, until the next picked fix. */
  picked: () => string | undefined
  /** Remember a folder the user just picked. */
  remember: (root: string) => void
  /** Forget the remembered pick. */
  forget: () => void
}

export interface FixOutcome {
  result: Readiness
  /** Project a switch fix selected. */
  selected?: string
  error?: string
}

/** One check per folder at a time; concurrent callers share it. */
const flight = new Map<string, Promise<Readiness>>()

export function check(root: string, deps: ReadinessDeps): Promise<Readiness> {
  const key = canonicalizePath(root)
  const running = flight.get(key)
  if (running) return running
  const next = probe(root, deps).finally(() => flight.delete(key))
  flight.set(key, next)
  return next
}

/** Run one fix, then re-check (bypassing any check in flight) and report the new state. */
export async function fix(
  root: string,
  request: Pick<FixReadinessRequest, "fix" | "target" | "identity">,
  deps: FixDeps,
): Promise<FixOutcome> {
  const done = await apply(root, request, deps).then(
    (value) => value,
    (err: unknown) => ({
      error: err instanceof Error ? err.message : String(err),
      root,
      selected: undefined,
      note: false,
    }),
  )
  const probed = await probe(done.root, deps)
  const result = "picked" in done && done.picked && probed.status === "blocked" ? { ...probed, picked: true } : probed
  const outcome = {
    result:
      result.status === "ready" && done.note ? { status: "ready" as const, note: "uncommitted" as const } : result,
  }
  if ("error" in done) return { ...outcome, error: done.error }
  if (done.selected) return { ...outcome, selected: done.selected }
  return outcome
}

async function probe(root: string, deps: ReadinessDeps): Promise<Readiness> {
  return inspect(root, deps).catch((err: unknown) => ({
    status: "unknown" as const,
    detail: err instanceof Error ? err.message : String(err),
  }))
}

async function inspect(root: string, deps: ReadinessDeps): Promise<Readiness> {
  // Git: not checked yet.
  // Repository and commits.
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
  if (!state.root) return folder(root, deps)
  if (state.empty) {
    return {
      status: "blocked",
      code: "no_commits",
      name: path.basename(state.root),
      trusted: deps.trusted(),
      identity: await prepare.identity(state.root, deps.git),
    }
  }
  // Git LFS: not checked yet.
  return { status: "ready" }
}

/** A folder that is not a Git project: offer the projects inside it, or setting up Git. */
async function folder(root: string, deps: ReadinessDeps): Promise<Readiness> {
  const base = { status: "blocked" as const, code: "not_git_repo" as const, name: path.basename(root) }
  const { projects: found, truncated } = await children(root)
  if (found.length > 0) {
    return {
      ...base,
      trusted: deps.trusted(),
      projects: found.slice(0, LIMIT),
      ...(found.length > LIMIT || truncated ? { more: true } : {}),
    }
  }
  return { ...base, trusted: deps.trusted(), identity: await prepare.identity(root, deps.git) }
}

/** Direct child folders that contain `.git`, probed with bounded concurrency. */
async function children(root: string): Promise<{ projects: ReadinessProject[]; truncated: boolean }> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  const scanned = dirs.slice(0, SCAN)
  const found: ReadinessProject[] = []
  let index = 0
  const worker = async () => {
    while (found.length <= LIMIT && index < scanned.length) {
      const name = scanned[index++]!
      const dir = path.join(root, name)
      if (await exists(path.join(dir, ".git"))) found.push({ root: dir, label: name })
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE, scanned.length) }, worker))
  return { projects: found.sort((a, b) => a.label.localeCompare(b.label)), truncated: dirs.length > SCAN }
}

function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

async function apply(
  root: string,
  request: Pick<FixReadinessRequest, "fix" | "target" | "identity">,
  deps: FixDeps,
): Promise<{ root: string; selected?: string; picked?: boolean; note: boolean }> {
  trust(deps)
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
  allow(state.root ?? root)
  if (request.fix === "initialCommit" && !state.root) throw new Error(`Not a Git repository: ${root}`)
  if (!request.identity && !(await prepare.identity(root, deps.git)))
    throw new Error("Git needs a name and email before Kilo can create the first commit.")
  trust(deps)
  const repo = state.root ?? (await prepare.initialize(root, deps.git))
  trust(deps)
  await deps.exclude(repo)
  trust(deps)
  if (request.identity) await prepare.configure(repo, deps.git, request.identity)
  trust(deps)
  await prepare.commit(repo, deps.git)
  const status = await deps.git.execGit(["-c", "core.fsmonitor=false", "status", "--porcelain"], repo)
  return { repo, note: status.code === 0 && status.stdout.trim().length > 0 }
}

/** Select a Git project nested directly inside the current folder. */
async function nested(
  root: string,
  value: string | undefined,
  deps: FixDeps,
): Promise<{ root: string; selected?: string; note: boolean }> {
  const target = value ? canonicalizePath(value) : ""
  const parent = deps.picked()
  const inside = (base: string | undefined) => base !== undefined && samePath(path.dirname(target), base)
  if (!target || (!inside(root) && !inside(parent)) || !(await exists(path.join(target, ".git"))))
    throw new Error(`Not a Git project inside ${root}: ${value ?? ""}`)
  const done = await select(target, deps)
  deps.forget()
  return done
}

/** Use the folder the user just picked: attach it when it is a repository, otherwise remember it for setup. */
async function choose(
  root: string,
  deps: FixDeps,
): Promise<{ root: string; selected?: string; picked?: boolean; note: boolean }> {
  const dir = await deps.pick()
  if (!dir) return { root, note: false }
  const state = await prepare.inspect(dir, deps.git)
  const picked = state.root ?? canonicalizePath(dir)
  allow(picked)
  trust(deps)
  if (state.root) {
    deps.forget()
    return { root: picked, selected: await deps.attach(picked), note: false }
  }
  deps.remember(picked)
  return { root: picked, picked: true, note: false }
}

/** Set up Git in the folder the user just picked, then attach and select it. */
async function usePick(
  value: string,
  request: Pick<FixReadinessRequest, "fix" | "identity">,
  deps: FixDeps,
): Promise<{ root: string; selected: string; note: boolean }> {
  const remembered = deps.picked()
  const target = value === "picked" ? remembered : canonicalizePath(value)
  if (!remembered || !target || !samePath(target, remembered)) {
    deps.forget()
    throw new Error("That folder is no longer the one you picked. Pick it again.")
  }
  allow(remembered)
  trust(deps)
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
async function select(dir: string, deps: FixDeps): Promise<{ root: string; selected?: string; note: boolean }> {
  const state = await prepare.inspect(dir, deps.git)
  const root = state.root ?? canonicalizePath(dir)
  allow(root)
  trust(deps)
  if (!state.root) return { root, note: false }
  return { root, selected: await deps.attach(root), note: false }
}
