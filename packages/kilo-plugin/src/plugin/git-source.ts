export * as PluginGitSource from "./git-source.js"

import path from "path"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { PluginModule } from "@opencode/core/plugin/module"
import { Flock } from "@opencode/util/flock"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"

// A git plugin spec is `git:<repo>[@ref][#subpath]`. The repo part must not
// contain `@`: the ref is everything after the last `@` and the subpath is
// everything after the first `#`. A git plugin installs no package
// dependencies, so it must be self-contained.
export type GitPluginSpec = {
  repo: string
  ref?: string
  subpath?: string
}

export type GitPluginErrorCode = "invalid_spec" | "not_cached" | "clone_failed" | "subpath_missing"

export type GitPluginResult = { ok: true; target: string } | { ok: false; code: GitPluginErrorCode; error: unknown }

type Marker = {
  repo: string
  ref?: string
  sha?: string
  updatedAt?: number
}

const PREFIX = "git:"
// A mutable ref is re-checked after this long so branch installs can pick up fixes.
const TTL = 60 * 60 * 1000
// A clone nobody resolved for this long is removed, as is an interrupted clone's staging directory after an hour.
const RETENTION = 7 * 24 * 60 * 60 * 1000
const STAGING_RETENTION = 60 * 60 * 1000
let collectedAt = 0

// Refs come from the spec and are passed to git as positional arguments, so a
// leading `-` or an invalid refname must be rejected to avoid option injection.
const REF = /^(?!-)(?!.*\.\.)(?!.*@\{)[^\s~^:?*[\]\\@#]+$/

function isSafeGitRef(ref: string) {
  if (!REF.test(ref)) return false
  if (ref.endsWith(".") || ref.endsWith(".lock")) return false
  return true
}

// Parse a `file:` URL without platform-dependent helpers so the result is the
// same on Windows and POSIX. A drive-less URL such as `file:///tmp/repo` is
// valid here, while `fileURLToPath` rejects it on Windows. A Windows drive
// letter is moved out of the path prefix so `file:///C:/x` becomes `C:/x`.
function fileUrlPath(repo: string): string | undefined {
  try {
    const url = new URL(repo)
    if (url.hostname && url.hostname !== "localhost") return undefined
    return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)(?=\/|$)/, "$1")
  } catch {
    return undefined
  }
}

function isLocalRepo(repo: string) {
  if (repo.startsWith("file:")) {
    const local = fileUrlPath(repo)
    return Boolean(local && local.replace(/^\/+/, "").length > 0)
  }
  if (path.isAbsolute(repo) || /^[A-Za-z]:[\\/]/.test(repo)) return true
  return repo.startsWith("./") || repo.startsWith("../") || repo.startsWith("~/")
}

// Shorthand repos must look like `host.tld/path`, which rejects scp-style
// `git@host:path` and bare words. URLs must not embed credentials.
function isSafeRepo(repo: string) {
  if (repo.includes("@")) return false
  if (isLocalRepo(repo)) return true
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repo)) {
    try {
      const url = new URL(repo)
      if (url.username || url.password) return false
      return Boolean(url.hostname)
    } catch {
      return false
    }
  }
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\/.+/.test(repo)
}

// `git://host/path` is an npm Git dependency the upstream loader installs, not a Kilo `git:` spec, so it must reach
// npm unchanged.
export function isGitPluginSpec(spec: string) {
  return spec.startsWith(PREFIX) && spec.length > PREFIX.length && !spec.startsWith("git://")
}

export function parseGitPluginSpec(spec: string): GitPluginSpec | undefined {
  if (!isGitPluginSpec(spec)) return undefined
  const raw = spec.slice(PREFIX.length)
  const hash = raw.indexOf("#")
  const before = hash === -1 ? raw : raw.slice(0, hash)
  const subpath = hash === -1 ? undefined : raw.slice(hash + 1).trim() || undefined
  const at = before.lastIndexOf("@")
  const repo = (at === -1 ? before : before.slice(0, at)).trim()
  const ref = at === -1 ? undefined : before.slice(at + 1).trim() || undefined
  if (!repo || !isSafeRepo(repo)) return undefined
  if (ref && !isSafeGitRef(ref)) return undefined
  return { repo, ref, subpath }
}

// A backslash is a path separator only on Windows. Normalizing it on POSIX
// would rewrite a legal filename, so only Windows-style paths are converted.
function isWindowsPath(repo: string) {
  return /^[A-Za-z]:[\\/]/.test(repo) || repo.startsWith("\\\\")
}

function normalizeRepo(repo: string) {
  const base = repo.startsWith("file:")
    ? (fileUrlPath(repo) ?? repo.replace(/^file:\/*/, "/"))
    : repo.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "")
  // Use forward slashes so a plain Windows path and its `file://` URL form
  // resolve to the same identity and cache entry.
  if (!isWindowsPath(base)) return base
  return base.replace(/\\/g, "/")
}

// The identity is the installed-state key and must equal the catalog item id. It
// is namespaced with `git/` so it cannot collide with an npm name or a local
// path, and drops the scheme and `.git` suffix: `git/github.com/owner/repo` or
// `git/github.com/owner/repo/plugins/my-plugin`.
export function gitPluginIdentity(spec: string): string | undefined {
  const hit = parseGitPluginSpec(spec)
  if (!hit) return undefined
  const base = normalizeRepo(hit.repo)
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
  const sub = hit.subpath?.replace(/^\/+|\/+$/g, "")
  return `git/${sub ? `${base}/${sub}` : base}`
}

function cloneUrl(repo: string) {
  // Local repos are cloned from a plain filesystem path: Git for Windows is
  // inconsistent with `file:///C:/...` URLs. normalizeRepo also makes the
  // `file://` form and the plain path share one marker, so a later resolve of
  // the other form reuses the first clone instead of cloning again.
  if (repo.startsWith("file:")) return fileUrlPath(repo) ?? repo
  if (repo.startsWith("./") || repo.startsWith("../")) return repo
  // `~` is only meaningful as a local home path, so expand it here.
  if (repo.startsWith("~/")) return path.join(homedir(), repo.slice(2))
  if (path.isAbsolute(repo) || /^[A-Za-z]:[\\/]/.test(repo)) return normalizeRepo(repo)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repo)) return repo
  // Shorthand like `github.com/owner/repo` would otherwise resolve as a local path.
  return `https://${repo}`
}

/** The directory holding every cached git plugin clone. */
export function cacheRoot() {
  return path.join(Global.Path.cache, "packages", "git")
}

function cachePaths(identity: string, ref: string | undefined) {
  const safe = identity.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || "repo"
  // The ref is part of the cache key so different refs of one repo can coexist
  // and a re-resolve cannot delete a directory another ref is reading.
  const digest = createHash("sha1")
    .update(`${identity}@${ref ?? ""}`)
    .digest("hex")
    .slice(0, 10)
  const root = cacheRoot()
  const name = `${safe}-${digest}`
  return { dir: path.join(root, name), marker: path.join(root, `${name}.json`) }
}

async function git(args: string[], cwd?: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // No console window flashes on Windows for each git call.
    windowsHide: true,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    const detail = stderr.trim() || stdout.trim()
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }
  return stdout
}

function isImmutableRef(ref: string | undefined) {
  return Boolean(ref) && /^[0-9a-f]{40}$/i.test(ref!)
}

async function reuse(dir: string, marker: string, repo: string, ref: string | undefined) {
  if (!(await stat(dir).catch(() => undefined))) return false
  const prev: Marker | undefined = await Bun.file(marker)
    .json()
    .catch(() => undefined)
  if (!prev) return false
  if (prev.repo !== repo || (prev.ref ?? undefined) !== (ref ?? undefined)) return false
  // A commit SHA is immutable; a branch or default ref is re-checked after the TTL.
  const fresh = isImmutableRef(ref) || Date.now() - (prev.updatedAt ?? 0) < TTL
  // Touch the marker so the retention sweep only removes clones nothing resolves.
  if (fresh) await writeFile(marker, JSON.stringify({ ...prev, updatedAt: Date.now() }))
  return fresh
}

async function cloneInto(repo: string, ref: string | undefined, dir: string, marker: string) {
  const tmp = `${dir}.tmp-${randomUUID().slice(0, 8)}`
  await rm(tmp, { recursive: true, force: true })
  await mkdir(path.dirname(dir), { recursive: true })
  try {
    // `--` stops git from treating the repo or ref as an option.
    await git(["clone", "--depth", "1", "--", repo, tmp])
    if (ref) {
      // A shallow clone carries only the default branch; fetch the requested ref
      // (branch or tag) and detach onto it.
      await git(["fetch", "--depth", "1", "origin", "--", ref], tmp)
      await git(["checkout", "--detach", "FETCH_HEAD"], tmp)
    }
    const sha = (await git(["rev-parse", "HEAD"], tmp)).trim()
    // Drop git metadata so the cached plugin directory is plain files.
    await rm(path.join(tmp, ".git"), { recursive: true, force: true })
    // Swap the finished clone into place so a reader never sees a half-cloned dir.
    await rm(dir, { recursive: true, force: true })
    await rename(tmp, dir)
    await writeFile(marker, JSON.stringify({ repo, ...(ref ? { ref } : {}), sha, updatedAt: Date.now() }))
  } catch (err) {
    // A failed clone must not leave a staging directory behind. After a
    // successful rename the staging path is already gone.
    await rm(tmp, { recursive: true, force: true })
    throw err
  }
}

/**
 * Resolve a `git:` plugin spec to a cached local directory. The cache lives under {@link cacheRoot}, and the
 * returned target is an absolute path: the plugin loader treats it like any other configured local directory
 * once the source is resolved. `refresh: false` reads only a clone that is already cached and fresh, so a caller
 * that must not touch the network can defer the clone; it reports `not_cached` when there is nothing to read.
 */
export async function resolveGitPluginTarget(
  spec: string,
  options?: { readonly refresh?: boolean },
): Promise<GitPluginResult> {
  const hit = parseGitPluginSpec(spec)
  const identity = gitPluginIdentity(spec)
  if (!hit || !identity)
    return { ok: false, code: "invalid_spec", error: new Error(`Invalid git plugin spec: ${spec}`) }

  const url = cloneUrl(hit.repo)
  const { dir, marker } = cachePaths(identity, hit.ref)
  try {
    await using _ = await Flock.acquire(`plugin-git:${dir}`)
    if (!(await reuse(dir, marker, url, hit.ref))) {
      if (options?.refresh === false)
        return { ok: false, code: "not_cached", error: new Error(`Plugin clone not cached: ${spec}`) }
      await cloneInto(url, hit.ref, dir, marker)
    }
  } catch (err) {
    return { ok: false, code: "clone_failed", error: err }
  }
  if (Date.now() - collectedAt >= TTL) {
    collectedAt = Date.now()
    await collect()
  }
  return locate(spec, hit, dir)
}

async function locate(spec: string, hit: GitPluginSpec, dir: string): Promise<GitPluginResult> {
  const root = await realpath(dir).catch(() => undefined)
  if (!root) return { ok: false, code: "subpath_missing", error: new Error(`Plugin clone missing for ${spec}`) }
  let target = root
  if (hit.subpath) {
    const sub = hit.subpath.replace(/^\/+/, "")
    // Resolve symlinks before the containment check so a symlinked subpath
    // cannot escape the clone.
    const resolved = await realpath(path.resolve(root, sub)).catch(() => undefined)
    if (!resolved || !FSUtil.contains(root, resolved)) {
      return { ok: false, code: "subpath_missing", error: new Error(`Plugin subpath not found: ${spec}`) }
    }
    target = resolved
  }

  const info = await stat(target).catch(() => undefined)
  if (!info) return { ok: false, code: "subpath_missing", error: new Error(`Plugin path not found: ${spec}`) }
  if (!info.isDirectory()) {
    const detail = hit.subpath ? ` ${hit.subpath}` : ""
    return { ok: false, code: "subpath_missing", error: new Error(`Plugin directory not found:${detail} in ${spec}`) }
  }
  return { ok: true, target }
}

/**
 * Cache hygiene, like `Npm.collect`: an interrupted clone leaves a staging directory, and a clone nothing resolves
 * for a week is dead weight. Both ages are rewritten by a refresh, so an entry being read or re-cloned is never
 * swept. A resolve runs it at most once an hour.
 */
export async function collect() {
  const now = Date.now()
  const root = cacheRoot()
  const entries = await readdir(root).catch(() => [] as string[])
  const present = new Set(entries)
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(root, entry)
      if (entry.includes(".tmp-")) {
        const info = await stat(file).catch(() => undefined)
        if (info && now - info.mtimeMs > STAGING_RETENTION) await rm(file, { recursive: true, force: true })
        return
      }
      if (!entry.endsWith(".json")) return
      const dir = entry.slice(0, -".json".length)
      const marker: Marker | undefined = await Bun.file(file)
        .json()
        .catch(() => undefined)
      if (present.has(dir) && now - (marker?.updatedAt ?? 0) <= RETENTION) return
      await rm(path.join(root, dir), { recursive: true, force: true })
      await rm(file, { force: true })
    }),
  )
  // A directory whose marker never appeared is an interrupted swap; age it by its own mtime.
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.endsWith(".json") || entry.includes(".tmp-") || present.has(`${entry}.json`)) return
      const file = path.join(root, entry)
      const info = await stat(file).catch(() => undefined)
      if (info && now - info.mtimeMs > RETENTION) await rm(file, { recursive: true, force: true })
    }),
  )
}

/**
 * The host resolver the plugin loader receives as `pluginSource`: `git:` specs resolve to their cached clone,
 * every other target keeps the loader's own local/npm handling. A clone needs the installing pass, so a
 * non-installing pass reports `pending` rather than going to the network; the resolution also names the policy
 * resources it stands for, so a denied plugin cannot load under a second spelling.
 */
export const pluginSource = (target: string, options: { readonly install: boolean }) =>
  Effect.gen(function* () {
    if (!isGitPluginSpec(target)) return undefined
    const hit = parseGitPluginSpec(target)
    const identity = gitPluginIdentity(target)
    if (!hit || !identity)
      return yield* Effect.fail(new PluginModule.LoadError({ message: `Invalid git plugin spec: ${target}` }))
    const result = yield* Effect.promise(() => resolveGitPluginTarget(target, { refresh: options.install }))
    if (!result.ok) {
      if (result.code === "not_cached") return { pending: true as const }
      const detail = result.error instanceof Error ? result.error.message : String(result.error)
      return yield* Effect.fail(
        new PluginModule.LoadError({ message: `Failed to resolve git plugin ${target}: ${detail}` }),
      )
    }
    const source = isLocalRepo(hit.repo) ? cloneUrl(hit.repo) : undefined
    return {
      target: result.target,
      resources: [identity, ...(source && path.isAbsolute(source) ? [source] : [])],
    }
  })
