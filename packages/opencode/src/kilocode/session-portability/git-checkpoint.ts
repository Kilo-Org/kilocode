// kilocode_change - new file
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const WORKSPACE_CHECKPOINT_KEY = "kilocodeWorkspaceCheckpoint"

export type WorkspaceCheckpoint = {
  version: 1
  gitUrl?: string
  branch?: string
  head: string
  patch: string
  createdAt: number
}

export type RestoreResult =
  | { status: "restored"; directory: string }
  | { status: "skipped"; reason: "not_git_repo" | "different_repo" | "missing_commit" | "no_checkpoint" }
  | { status: "failed"; reason: "worktree_failed" | "patch_failed"; directory?: string; error: string }

type RunOptions = {
  input?: string
  env?: Record<string, string>
  ok?: number[]
  trim?: boolean
}

async function run(dir: string, args: string[], opts: RunOptions = {}) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdin: opts.input ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  })
  if (opts.input && proc.stdin) {
    proc.stdin.write(opts.input)
    proc.stdin.end()
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (!(opts.ok ?? [0]).includes(code)) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed with ${code}`)
  }
  return { code, stdout: opts.trim === false ? stdout : stdout.trim(), stderr: stderr.trim() }
}

export function normalizeGitUrl(raw: string | undefined) {
  if (!raw) return undefined
  const ssh = raw.match(/^git@([^:]+):(.+)$/)
  if (ssh) {
    const repo = ssh[2].split("?")[0].replace(/\.git$/, "").replace(/\/$/, "")
    return `${ssh[1].toLowerCase()}/${repo}`
  }
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ssh:") return undefined
    url.username = ""
    url.password = ""
    url.search = ""
    url.hash = ""
    const repo = url.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "")
    if (!repo) return undefined
    return `${url.hostname.toLowerCase()}/${repo}`
  } catch {
    return undefined
  }
}

async function root(dir: string) {
  return run(dir, ["rev-parse", "--show-toplevel"])
    .then((out) => out.stdout)
    .catch(() => undefined)
}

async function head(dir: string) {
  return run(dir, ["rev-parse", "HEAD"]).then((out) => out.stdout)
}

async function branch(dir: string) {
  return run(dir, ["branch", "--show-current"]).then((out) => out.stdout || undefined)
}

async function remote(dir: string) {
  const origin = await run(dir, ["config", "--get", "remote.origin.url"], { ok: [0, 1] })
  if (origin.stdout) return normalizeGitUrl(origin.stdout)
  const names = await run(dir, ["remote"], { ok: [0, 1] })
  const name = names.stdout.split(/\s+/).find(Boolean)
  if (!name) return undefined
  return run(dir, ["config", "--get", `remote.${name}.url`], { ok: [0, 1] }).then((out) => normalizeGitUrl(out.stdout))
}

async function patch(dir: string, base: string) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-index-"))
  const idx = path.join(tmp, "index")
  const env = { GIT_INDEX_FILE: idx }
  try {
    await run(dir, ["read-tree", base], { env })
    // Respect normal gitignore rules so checkpoints do not carry ignored build outputs or secrets.
    await run(dir, ["add", "--all", "--", "."], { env })
    return await run(dir, ["diff", "--cached", "--binary", "--full-index", base, "--"], { env, trim: false }).then(
      (out) => out.stdout,
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

export async function captureWorkspaceCheckpoint(input: {
  directory: string
  now?: () => number
}): Promise<WorkspaceCheckpoint | undefined> {
  const dir = await root(input.directory)
  if (!dir) return undefined
  const base = await head(dir)
  return {
    version: 1,
    ...(await remote(dir).then((gitUrl) => (gitUrl ? { gitUrl } : {}))),
    ...(await branch(dir).then((name) => (name ? { branch: name } : {}))),
    head: base,
    patch: await patch(dir, base),
    createdAt: input.now?.() ?? Date.now(),
  }
}

export async function attachWorkspaceCheckpoint<T extends { directory?: string }>(
  input: T,
  opts?: { now?: () => number },
): Promise<T & { [WORKSPACE_CHECKPOINT_KEY]?: WorkspaceCheckpoint }> {
  if (!input.directory) return { ...input }
  const checkpoint = await captureWorkspaceCheckpoint({ directory: input.directory, now: opts?.now }).catch(
    () => undefined,
  )
  if (!checkpoint) return { ...input }
  return { ...input, [WORKSPACE_CHECKPOINT_KEY]: checkpoint }
}

function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

export function readWorkspaceCheckpoint(input: unknown): WorkspaceCheckpoint | undefined {
  const item = record(input) ? input[WORKSPACE_CHECKPOINT_KEY] : undefined
  if (!record(item)) return undefined
  if (item.version !== 1) return undefined
  if (typeof item.head !== "string") return undefined
  if (typeof item.patch !== "string") return undefined
  if (typeof item.createdAt !== "number") return undefined
  return {
    version: 1,
    ...(typeof item.gitUrl === "string" ? { gitUrl: item.gitUrl } : {}),
    ...(typeof item.branch === "string" ? { branch: item.branch } : {}),
    head: item.head,
    patch: item.patch,
    createdAt: item.createdAt,
  }
}

function clean(input: string) {
  return input.replace(/[^A-Za-z0-9_-]/g, "-")
}

async function target(dir: string, sessionID: string) {
  const base = (await root(dir)) ?? dir
  return path.join(path.dirname(base), ".kilo-session-worktrees", `${clean(sessionID)}-${Date.now().toString(36)}`)
}

export async function restoreCloudSessionWorkspace(input: {
  info: unknown
  directory: string
  sessionID: string
  targetDirectory?: string
}): Promise<{ directory: string; result: RestoreResult }> {
  const checkpoint = readWorkspaceCheckpoint(input.info)
  const result = await restoreWorkspaceCheckpoint({
    directory: input.directory,
    checkpoint,
    targetDirectory: input.targetDirectory ?? (await target(input.directory, input.sessionID)),
    branch: `kilo/session/${input.sessionID}`,
  })
  return {
    directory: result.status === "restored" ? result.directory : input.directory,
    result,
  }
}

async function commit(dir: string, sha: string) {
  const hit = await run(dir, ["cat-file", "-e", `${sha}^{commit}`], { ok: [0, 1] })
  if (hit.code === 0) return true
  await run(dir, ["fetch", "--all", "--quiet"], { ok: [0, 1] })
  return run(dir, ["cat-file", "-e", `${sha}^{commit}`], { ok: [0, 1] }).then((out) => out.code === 0)
}

async function uniqueBranch(dir: string, base: string) {
  const clean = base.replace(/[^A-Za-z0-9/_-]/g, "-")
  const pick = async (name: string, attempt = 0): Promise<string> => {
    const hit = await run(dir, ["rev-parse", "--verify", `refs/heads/${name}`], { ok: [0, 1, 128] })
    if (hit.code !== 0) return name
    return pick(`${clean}-${attempt + 1}`, attempt + 1)
  }
  return pick(clean)
}

async function removeWorktree(dir: string, target: string) {
  await run(dir, ["worktree", "remove", "--force", target], { ok: [0, 1, 128] }).catch(() => undefined)
}

export async function restoreWorkspaceCheckpoint(input: {
  directory: string
  checkpoint: WorkspaceCheckpoint | undefined
  targetDirectory: string
  branch: string
}): Promise<RestoreResult> {
  if (!input.checkpoint) return { status: "skipped", reason: "no_checkpoint" }
  const dir = await root(input.directory)
  if (!dir) return { status: "skipped", reason: "not_git_repo" }

  const url = await remote(dir)
  if (input.checkpoint.gitUrl && url !== input.checkpoint.gitUrl) {
    return { status: "skipped", reason: "different_repo" }
  }

  if (!(await commit(dir, input.checkpoint.head))) return { status: "skipped", reason: "missing_commit" }

  const name = await uniqueBranch(dir, input.branch)
  await mkdir(path.dirname(input.targetDirectory), { recursive: true })
  const added = await run(dir, ["worktree", "add", "-b", name, input.targetDirectory, input.checkpoint.head], {
    ok: [0, 1],
  }).catch((err) => ({ code: 1, stderr: err instanceof Error ? err.message : String(err) }))
  if (added.code !== 0) {
    return { status: "failed", reason: "worktree_failed", error: added.stderr || "unable to create worktree" }
  }

  if (input.checkpoint.patch.trim()) {
    const applied = await run(input.targetDirectory, ["apply", "--3way", "--whitespace=nowarn"], {
      input: input.checkpoint.patch,
      ok: [0, 1],
    }).catch((err) => ({ code: 1, stderr: err instanceof Error ? err.message : String(err) }))
    if (applied.code !== 0) {
      await removeWorktree(dir, input.targetDirectory)
      return { status: "failed", reason: "patch_failed", directory: input.targetDirectory, error: applied.stderr }
    }
  }

  return { status: "restored", directory: input.targetDirectory }
}
