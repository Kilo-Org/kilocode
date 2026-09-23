import { createHash } from "crypto"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
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
}

const PREFIX = "git:"

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
  if (!repo) return undefined
  // The repo must not embed credentials or a user; ref is the only `@` split.
  if (repo.includes("@")) return undefined
  return { repo, ref, subpath }
}

function normalizeRepo(repo: string) {
  if (repo.startsWith("file://")) {
    try {
      return fileURLToPath(repo)
    } catch {
      return repo.slice("file://".length)
    }
  }
  const scheme = repo.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
  if (scheme) return repo.slice(scheme[0].length)
  return repo
}

// The identity is the installed-state key and must equal the catalog item id. It
// drops the scheme and the `.git` suffix, and keeps the subpath as a plain slug:
// `github.com/owner/repo` or `github.com/owner/repo/plugins/my-plugin`. Local
// repos keep their absolute path.
export function gitPluginIdentity(spec: string): string | undefined {
  const hit = parseGitPluginSpec(spec)
  if (!hit) return undefined
  const base = normalizeRepo(hit.repo)
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
  const sub = hit.subpath?.replace(/^\/+|\/+$/g, "")
  return sub ? `${base}/${sub}` : base
}

function cloneUrl(repo: string) {
  if (repo.startsWith("file://")) return repo
  if (repo.startsWith("./") || repo.startsWith("../")) return repo
  if (path.isAbsolute(repo) || /^[A-Za-z]:[\\/]/.test(repo)) return repo
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repo)) return repo
  // Shorthand like `github.com/owner/repo` would otherwise resolve as a local path.
  return `https://${repo}`
}

function cachePaths(identity: string) {
  const safe = identity.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || "repo"
  const digest = createHash("sha1").update(identity).digest("hex").slice(0, 10)
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

async function reuse(dir: string, marker: string, repo: string, ref: string | undefined) {
  if (!(await Filesystem.exists(dir))) return false
  const prev = await Filesystem.readJson<Marker>(marker).catch(() => undefined)
  if (!prev) return false
  return prev.repo === repo && (prev.ref ?? undefined) === (ref ?? undefined)
}

async function cloneInto(repo: string, ref: string | undefined, dir: string, marker: string) {
  await rm(dir, { recursive: true, force: true })
  await rm(marker, { force: true })
  await mkdir(path.dirname(dir), { recursive: true })
  await git(["clone", "--depth", "1", repo, dir])
  if (ref) {
    // A shallow clone carries only the default branch; fetch the requested ref
    // (branch or tag) and detach onto it.
    await git(["fetch", "--depth", "1", "origin", ref], dir)
    await git(["checkout", "--detach", "FETCH_HEAD"], dir)
  }
  // Drop git metadata so the cached plugin directory is plain files.
  await rm(path.join(dir, ".git"), { recursive: true, force: true })
  await Filesystem.writeJson(marker, { repo, ...(ref ? { ref } : {}) })
}

export async function resolveGitPluginTarget(spec: string): Promise<GitPluginResult> {
  const hit = parseGitPluginSpec(spec)
  const identity = gitPluginIdentity(spec)
  if (!hit || !identity)
    return { ok: false, code: "invalid_spec", error: new Error(`Invalid git plugin spec: ${spec}`) }

  const url = cloneUrl(hit.repo)
  const { dir, marker } = cachePaths(identity)
  try {
    await using _ = await Flock.acquire(`plugin-git:${dir}`)
    if (!(await reuse(dir, marker, url, hit.ref))) await cloneInto(url, hit.ref, dir, marker)
  } catch (err) {
    return { ok: false, code: "clone_failed", error: err }
  }

  let target = dir
  if (hit.subpath) {
    const sub = hit.subpath.replace(/^\/+/, "")
    target = path.resolve(dir, sub)
    if (target !== path.resolve(dir) && !Filesystem.contains(dir, target)) {
      return { ok: false, code: "subpath_missing", error: new Error(`Plugin subpath escapes repo: ${hit.subpath}`) }
    }
  }

  const stat = await Filesystem.statAsync(target)
  if (!stat?.isDirectory()) {
    const detail = hit.subpath ? ` ${hit.subpath}` : ""
    return { ok: false, code: "subpath_missing", error: new Error(`Plugin directory not found:${detail} in ${spec}`) }
  }
  return { ok: true, target: pathToFileURL(target).href }
}
