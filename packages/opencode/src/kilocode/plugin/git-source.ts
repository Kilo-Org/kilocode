import { createHash, randomUUID } from "crypto"
import { mkdir, realpath, rename, rm } from "fs/promises"
import { homedir } from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Global } from "@opencode-ai/core/global"
import { Flock } from "@opencode-ai/core/util/flock"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

// A git plugin spec is `git:<repo>[@ref][#subpath]`. The repo part must not
// contain `@`: the ref is everything after the last `@` and the subpath is
// everything after the first `#`. Version 1 installs no package dependencies,
// so a git plugin must be self-contained.
export type GitPluginSpec = {
  repo: string
  ref?: string
  subpath?: string
}

export type GitPluginErrorCode = "invalid_spec" | "clone_failed" | "subpath_missing"

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

export function isGitPluginSpec(spec: string) {
  return spec.startsWith(PREFIX) && spec.length > PREFIX.length
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

function cachePaths(identity: string, ref: string | undefined) {
  const safe = identity.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || "repo"
  // The ref is part of the cache key so different refs of one repo can coexist
  // and a re-resolve cannot delete a directory another ref is reading.
  const digest = createHash("sha1")
    .update(`${identity}@${ref ?? ""}`)
    .digest("hex")
    .slice(0, 10)
  const root = path.join(Global.Path.cache, "packages", "git")
  const name = `${safe}-${digest}`
  return { dir: path.join(root, name), marker: path.join(root, `${name}.json`) }
}

async function git(args: string[], cwd?: string) {
  const out = await Process.text(["git", ...args], { cwd, nothrow: true })
  if (out.code !== 0) {
    const detail = out.stderr.toString().trim() || out.text.trim()
    throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
  }
  return out.text
}

function isImmutableRef(ref: string | undefined) {
  return Boolean(ref) && /^[0-9a-f]{40}$/i.test(ref!)
}

async function reuse(dir: string, marker: string, repo: string, ref: string | undefined) {
  if (!(await Filesystem.exists(dir))) return false
  const prev = await Filesystem.readJson<Marker>(marker).catch(() => undefined)
  if (!prev) return false
  if (prev.repo !== repo || (prev.ref ?? undefined) !== (ref ?? undefined)) return false
  // A commit SHA is immutable; a branch or default ref is re-checked after the TTL.
  if (isImmutableRef(ref)) return true
  return Date.now() - (prev.updatedAt ?? 0) < TTL
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
    await Filesystem.writeJson(marker, { repo, ...(ref ? { ref } : {}), sha, updatedAt: Date.now() })
  } catch (err) {
    // A failed clone must not leave a staging directory behind. After a
    // successful rename the staging path is already gone.
    await rm(tmp, { recursive: true, force: true })
    throw err
  }
}

export async function resolveGitPluginTarget(spec: string): Promise<GitPluginResult> {
  const hit = parseGitPluginSpec(spec)
  const identity = gitPluginIdentity(spec)
  if (!hit || !identity)
    return { ok: false, code: "invalid_spec", error: new Error(`Invalid git plugin spec: ${spec}`) }

  const url = cloneUrl(hit.repo)
  const { dir, marker } = cachePaths(identity, hit.ref)
  try {
    await using _ = await Flock.acquire(`plugin-git:${dir}`)
    if (!(await reuse(dir, marker, url, hit.ref))) await cloneInto(url, hit.ref, dir, marker)
  } catch (err) {
    return { ok: false, code: "clone_failed", error: err }
  }

  const root = await realpath(dir).catch(() => undefined)
  if (!root) return { ok: false, code: "subpath_missing", error: new Error(`Plugin clone missing for ${spec}`) }
  let target = root
  if (hit.subpath) {
    const sub = hit.subpath.replace(/^\/+/, "")
    // Resolve symlinks before the containment check so a symlinked subpath
    // cannot escape the clone.
    const resolved = await realpath(path.resolve(root, sub)).catch(() => undefined)
    if (!resolved || (resolved !== root && !Filesystem.contains(root, resolved))) {
      return { ok: false, code: "subpath_missing", error: new Error(`Plugin subpath not found in ${spec}`) }
    }
    target = resolved
  }

  let stat
  try {
    stat = await Filesystem.statAsync(target)
  } catch (err) {
    return { ok: false, code: "subpath_missing", error: err }
  }
  if (!stat?.isDirectory()) {
    const detail = hit.subpath ? ` ${hit.subpath}` : ""
    return { ok: false, code: "subpath_missing", error: new Error(`Plugin directory not found:${detail} in ${spec}`) }
  }
  return { ok: true, target: pathToFileURL(target).href }
}
