import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { GitOps } from "../GitOps"
import { MISSING_GIT } from "../git-errors"
import { isRestrictedRoot } from "../home-workspace"
import { canonicalizePath, resolveProjectRoot, samePath } from "./paths"

type Git = Pick<GitOps, "execGit">

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" }
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_TEMPLATE_DIR",
    "GIT_EXEC_PATH",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
  ]) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key]
  }
  return env
}

async function run(dir: string, git: Git, args: string[], stdin?: string) {
  const result = await git.execGit(args, dir, { env: environment(), stdin })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Git failed in ${dir}`)
  return result.stdout.trimEnd()
}

/** Build a `resolveProjectRoot` adapter that strips ambient Git path, template, and config overrides. */
export function runner(git: Git) {
  return async (cwd: string, args: string[]) => {
    const result = await git.execGit(args, cwd, { env: environment() })
    if (result.code !== 0) throw new Error(result.stderr)
    return result.stdout
  }
}

async function directory(dir: string) {
  const real = await fs.realpath(dir)
  if (!(await fs.stat(real)).isDirectory()) throw new Error(`Not a directory: ${dir}`)
  return real === path.parse(real).root ? real : canonicalizePath(real)
}

function target(dir: string) {
  if (isRestrictedRoot(dir)) throw new Error(`Cannot initialize a project in a home folder or filesystem root: ${dir}`)
}

async function exists(file: string) {
  return fs.lstat(file).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false
      throw err
    },
  )
}

/** A portable single child-directory name, including Windows device-name rules. */
export function validName(name: string): boolean {
  return (
    name.length > 0 &&
    Buffer.byteLength(name) <= 255 &&
    name.trim() === name &&
    !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(?:\.git|con|conin\$|conout\$|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
      name,
    )
  )
}

/** Probe without interpreting missing Git, broken metadata, or unsafe ownership as a non-repository. */
export async function inspect(dir: string, git: Git): Promise<{ root: string | undefined; empty: boolean }> {
  const real = await directory(dir)
  const result = await git.execGit(["rev-parse", "--show-toplevel"], real, { env: environment() })
  if (result.code !== 0) {
    const missing = /^fatal: not a git repository \(or any of the parent directories\): \.git\s*$/.test(result.stderr)
    const boundary =
      /^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.\s*$/.test(
        result.stderr,
      )
    if (!missing && !boundary) {
      if (/\bENOENT\b/.test(result.stderr)) throw new Error(MISSING_GIT)
      throw new Error(result.stderr.trim() || `Cannot inspect Git repository: ${real}`)
    }
    // Invalid .git directories can produce the same diagnostic as a genuine non-repository.
    for (let parent = real; ; parent = path.dirname(parent)) {
      if (
        path.basename(parent).toLowerCase() === ".git" ||
        (await exists(path.join(parent, ".git"))) ||
        ((await exists(path.join(parent, "HEAD"))) && (await exists(path.join(parent, "objects"))))
      ) {
        throw new Error(`Cannot initialize a folder with existing or broken Git metadata: ${parent}`)
      }
      if (path.dirname(parent) === parent) break
    }
    return { root: undefined, empty: true }
  }

  // paths.ts supports older Git, but its fallback must not hide failed preparation probes.
  let failure: unknown
  const root = await resolveProjectRoot(real, async (cwd, args) => {
    try {
      return await run(cwd, git, args)
    } catch (err) {
      failure = err
      throw err
    }
  })
  if (failure) throw failure
  if (!root) throw new Error(`Cannot resolve Git repository: ${real}`)
  const canonical = await directory(root)
  const head = await git.execGit(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], real, { env: environment() })
  if (head.code === 0) return { root: canonical, empty: false }
  if (head.code !== 1) throw new Error(head.stderr.trim() || `Cannot inspect HEAD: ${real}`)
  const history = await run(real, git, ["rev-list", "-n", "1", "--all"])
  return { root: canonical, empty: !history }
}

/** Initialize only a genuine non-repository. Existing checkouts resolve to their main root. */
export async function initialize(dir: string, git: Git): Promise<string> {
  const real = await directory(dir)
  target(real)
  const state = await inspect(real, git)
  if (state.root) {
    target(state.root)
    return state.root
  }
  await run(real, git, ["-c", "init.templateDir=", "init"])
  const result = await inspect(real, git)
  if (!result.root || !samePath(result.root, real)) throw new Error(`Cannot verify initialized repository: ${real}`)
  return result.root
}

/**
 * Create a project folder exclusively. An existing folder is returned unchanged
 * so the caller can open it, unless it is a file. On failure, retain the
 * directory and any repository for recovery.
 */
export async function create(parent: string, name: string, git: Git): Promise<{ root: string; created: boolean }> {
  if (!validName(name)) throw new Error("Invalid project folder name")
  const real = await directory(parent)
  const dir = path.join(real, name)
  target(dir)
  if ((await inspect(real, git)).root) throw new Error(`Cannot create a nested Git repository: ${dir}`)
  try {
    await fs.mkdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "EEXIST") throw err
    const stats = await fs.stat(dir).catch(() => undefined)
    if (!stats?.isDirectory()) throw err
    return { root: await directory(dir), created: false }
  }
  try {
    const root = await initialize(dir, git)
    if (!samePath(root, dir)) throw new Error(`Cannot create a nested Git repository: ${dir}`)
    return { root, created: true }
  } catch (err) {
    throw new Error(`Project folder remains at ${dir}. ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Require explicit identity for both author and committer, never Git's OS-derived guesses. */
export async function identity(dir: string, git: Git) {
  for (const role of ["AUTHOR", "COMMITTER"]) {
    const result = await git.execGit(["-c", "user.useConfigOnly=true", "var", `GIT_${role}_IDENT`], dir, {
      env: environment(),
    })
    if (result.code === 0) continue
    if (
      /^fatal: (?:.*auto-detection is disabled|empty ident (?:name|email).*|name consists only of disallowed characters.*)\s*$/m.test(
        result.stderr,
      )
    )
      return false
    throw new Error(result.stderr.trim() || `Cannot read Git identity in ${dir}`)
  }
  return true
}

/** Save only explicitly approved identity fields, in the repository's local configuration. */
export async function configure(dir: string, git: Git, values: { name?: string; email?: string }): Promise<void> {
  const state = await inspect(dir, git)
  if (!state.root) throw new Error(`Not a Git repository: ${dir}`)
  target(state.root)
  for (const field of ["name", "email"] as const) {
    const value = values[field]
    if (value === undefined) continue
    if (!value.trim() || /[\r\n\x00]/.test(value)) throw new Error(`Invalid Git ${field}`)
    await run(state.root, git, ["config", "--local", `user.${field}`, value])
  }
}

/** Create an unsigned, empty bootstrap commit without the index or normal commit hooks. */
export async function commit(dir: string, git: Git): Promise<void> {
  const state = await inspect(dir, git)
  if (!state.root) throw new Error(`Not a Git repository: ${dir}`)
  target(state.root)
  if (!state.empty) return
  const branch = await run(state.root, git, ["symbolic-ref", "HEAD"])
  if (!branch.startsWith("refs/heads/")) throw new Error(`HEAD does not reference a branch: ${state.root}`)
  const tree = await run(state.root, git, ["mktree"], "")
  const hash = await run(state.root, git, [
    "-c",
    "user.useConfigOnly=true",
    "-c",
    "commit.gpgsign=false",
    "commit-tree",
    tree,
    "-m",
    "Initial commit",
  ])
  const current = await inspect(state.root, git)
  if (current.root !== state.root || (await run(state.root, git, ["symbolic-ref", "HEAD"])) !== branch)
    throw new Error(`Git repository or branch changed during preparation: ${state.root}`)
  if (!current.empty) return
  // Address the captured branch, not HEAD, and never replace a concurrently created ref.
  // `update-ref` can run the reference-transaction hook, so disable hooks and fsmonitor.
  const result = await git.execGit(
    [
      "-c",
      "core.hooksPath=",
      "-c",
      "core.fsmonitor=false",
      "update-ref",
      "--no-deref",
      "-m",
      "Initial commit",
      branch,
      hash,
      "0".repeat(hash.length),
    ],
    state.root,
    { env: environment() },
  )
  if ((await run(state.root, git, ["symbolic-ref", "HEAD"])) !== branch)
    throw new Error(`Git branch changed during preparation: ${state.root}`)
  if (result.code !== 0) {
    const latest = await inspect(state.root, git)
    if (latest.root === state.root && !latest.empty) return
    throw new Error(result.stderr.trim() || `Cannot create the initial branch: ${state.root}`)
  }
}
