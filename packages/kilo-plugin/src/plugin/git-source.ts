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
  // The canonical repo the clone belongs to, so two spellings of one repository share one entry.
  identity: string
  ref?: string
  // When the clone was last fetched; a mutable ref is re-checked once this is older than the TTL.
  updatedAt: number
  // When a resolve last used the clone; only this moves on a hit, so the TTL never slides.
  usedAt?: number
}

const PREFIX = "git:"
// A mutable ref is re-checked after this long so branch installs can pick up fixes.
const TTL = 60 * 60 * 1000
// A clone nobody resolved for this long is removed, as is an interrupted clone's staging directory after an hour.
const RETENTION = 7 * 24 * 60 * 60 * 1000
const STAGING_RETENTION = 60 * 60 * 1000
// A clone must not hold up plugin activation behind a credential or host-key prompt.
const GIT_TIMEOUT = 5 * 60 * 1000
// A sweep skips an entry whose lock another process holds for longer than this.
const LOCK_WAIT = 5_000
// Staging clones live in their own directory: a cache entry name never starts with `.`, so a sweep cannot
// mistake a live clone for an interrupted one.
const STAGING = ".staging"
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

function isSchemeUrl(repo: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(repo)
}

// Shorthand repos must look like `host.tld/path`, which rejects scp-style
// `git@host:path` and bare words. URLs must not embed credentials.
function isSafeRepo(repo: string) {
  if (repo.includes("@")) return false
  if (isLocalRepo(repo)) return true
  if (isSchemeUrl(repo)) {
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

// A subpath is a POSIX path inside the clone. `..` is rejected rather than normalized away, so a spec that
// tries to leave the clone is a spec error and not a silent read of a different directory.
function parseSubpath(raw: string): { ok: true; value?: string } | { ok: false } {
  const value = raw.trim()
  if (!value) return { ok: true }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/")).replace(/^\/+|\/+$/g, "")
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return { ok: false }
  return { ok: true, value: normalized }
}

export function parseGitPluginSpec(spec: string): GitPluginSpec | undefined {
  if (!isGitPluginSpec(spec)) return undefined
  const raw = spec.slice(PREFIX.length)
  const hash = raw.indexOf("#")
  const before = hash === -1 ? raw : raw.slice(0, hash)
  let subpath: string | undefined
  if (hash !== -1) {
    const parsed = parseSubpath(raw.slice(hash + 1))
    if (!parsed.ok) return undefined
    subpath = parsed.value
  }
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

const DEFAULT_PORTS = new Map([
  ["http:", "80"],
  ["https:", "443"],
  ["ssh:", "22"],
  ["git:", "9418"],
  ["ftp:", "21"],
])

function trimRepo(value: string) {
  return value.replace(/\/+$/, "").replace(/\.git$/i, "")
}

// A local path as one canonical string. A relative path is resolved on every platform; an absolute path is
// resolved only in the host's own style, since `path.resolve` would rewrite a Windows path on POSIX (and a POSIX
// absolute path on Windows) into a different directory. A Windows result uses forward slashes.
function localIdentity(local: string) {
  const windows = isWindowsPath(local)
  const relative = !windows && !local.startsWith("/")
  const absolute = relative || windows === (process.platform === "win32") ? path.resolve(local) : local
  return isWindowsPath(absolute) ? absolute.replace(/\\/g, "/") : absolute
}

// The canonical repository an identity and a `plugin.use` resource are derived from: a URL drops its scheme, host
// case and default port, a local path becomes absolute, and the `.git` suffix and trailing slashes go, as in v1.
// Without one canonical form, two spellings of one plugin would name different policy resources, so a deny on the
// canonical spelling would not cover them.
function repoIdentity(repo: string) {
  return trimRepo(repoKey(repo))
}

// The repository a clone is keyed by: the canonical form, except that a local path keeps a `.git` suffix, because
// `/srv/plugin` and `/srv/plugin.git` are different directories and must not share a clone.
function repoKey(repo: string) {
  if (isLocalRepo(repo)) {
    const local = repo.startsWith("file:")
      ? (fileUrlPath(repo) ?? repo)
      : repo.startsWith("~/")
        ? path.join(homedir(), repo.slice(2))
        : repo
    return localIdentity(local)
  }
  if (isSchemeUrl(repo)) {
    const url = new URL(repo)
    const protocol = url.protocol.toLowerCase()
    const port = url.port && url.port !== DEFAULT_PORTS.get(protocol) ? `:${url.port}` : ""
    return trimRepo(`${url.hostname.toLowerCase()}${port}${url.pathname}`)
  }
  // A shorthand `host.tld/owner/repo`: only the host is case-insensitive.
  return trimRepo(repo.replace(/^([^/]+)/, (host) => host.toLowerCase()))
}

// The identity is the installed-state key and must equal the catalog item id. It
// is namespaced with `git/` so it cannot collide with an npm name or a local
// path, and drops the scheme and `.git` suffix: `git/github.com/owner/repo` or
// `git/github.com/owner/repo/plugins/my-plugin`.
export function gitPluginIdentity(spec: string): string | undefined {
  const hit = parseGitPluginSpec(spec)
  if (!hit) return undefined
  const base = repoIdentity(hit.repo).replace(/^\/+/, "")
  return `git/${hit.subpath ? `${base}/${hit.subpath}` : base}`
}

function cloneUrl(repo: string) {
  // Local repos are cloned from a plain filesystem path: Git for Windows is
  // inconsistent with `file:///C:/...` URLs.
  if (repo.startsWith("file:")) return fileUrlPath(repo) ?? repo
  if (repo.startsWith("./") || repo.startsWith("../")) return repo
  // `~` is only meaningful as a local home path, so expand it here.
  if (repo.startsWith("~/")) return path.join(homedir(), repo.slice(2))
  // A Windows path is passed in its forward-slash form, the same string its identity uses.
  if (path.isAbsolute(repo) || /^[A-Za-z]:[\\/]/.test(repo)) return localIdentity(repo)
  if (isSchemeUrl(repo)) return repo
  // Shorthand like `github.com/owner/repo` would otherwise resolve as a local path.
  return `https://${repo}`
}

/** The directory holding every cached git plugin clone. */
export function cacheRoot() {
  return path.join(Global.Path.cache, "packages", "git")
}

function cachePaths(identity: string, ref: string | undefined) {
  const safe = identity.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || "repo"
  // One clone per repository and ref: a subpath is resolved inside it, so N plugins from one repository at one
  // ref share a clone. The ref stays in the key so a re-resolve cannot delete a directory another ref is reading.
  const digest = createHash("sha1").update(`${identity}@${ref ?? ""}`).digest("hex").slice(0, 10)
  const root = cacheRoot()
  const name = `${safe}-${digest}`
  return { dir: path.join(root, name), marker: path.join(root, `${name}.json`), staging: path.join(root, STAGING) }
}

// The directory a spec clones into, whether or not anything is cached there yet. A caller that must not touch the
// network reports this as the expected location, the way `Npm.resolve` reports an uninstalled package.
export function cacheDirectory(spec: string) {
  const hit = parseGitPluginSpec(spec)
  if (!hit) return undefined
  const dir = cachePaths(repoKey(hit.repo), hit.ref).dir
  // A subpath plugin lives inside the clone; reporting the root would read another plugin's manifest.
  return hit.subpath ? path.join(dir, hit.subpath) : dir
}

async function git(args: string[], cwd?: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    // A private repo must fail fast: an inherited stdin would let git prompt the terminal that owns the TUI.
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      // Without a configured ssh command, a host-key or passphrase prompt fails the clone instead of waiting on a
      // terminal the user cannot reach. A configured `GIT_SSH_COMMAND` or `GIT_SSH` is left as it is.
      ...(process.env.GIT_SSH_COMMAND || process.env.GIT_SSH ? {} : { GIT_SSH_COMMAND: "ssh -oBatchMode=yes" }),
    },
    // No console window flashes on Windows for each git call.
    windowsHide: true,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill()
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT}ms`))
    }, GIT_TIMEOUT)
  })
  try {
    const [stdout, stderr, code] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      timeout,
    ])
    if (code !== 0) {
      const detail = stderr.trim() || stdout.trim()
      throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`)
    }
    return stdout
  } finally {
    clearTimeout(timer)
  }
}

function isImmutableRef(ref: string | undefined) {
  return Boolean(ref) && /^[0-9a-f]{40}$/i.test(ref!)
}

// Written through a staging file so a concurrent sweep never reads half a marker.
async function writeMarker(file: string, marker: Marker) {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(marker))
  await rename(tmp, file)
}

async function reuse(dir: string, marker: string, identity: string, ref: string | undefined) {
  if (!(await stat(dir).catch(() => undefined))) return false
  const prev: Marker | undefined = await Bun.file(marker)
    .json()
    .catch(() => undefined)
  if (!prev) return false
  if (prev.identity !== identity || (prev.ref ?? undefined) !== (ref ?? undefined)) return false
  // A commit SHA is immutable; a branch or default ref is re-checked after the TTL.
  const fresh = isImmutableRef(ref) || Date.now() - prev.updatedAt < TTL
  // Touch only the retention stamp, so resolving a clone often never postpones its refresh.
  if (fresh) await writeMarker(marker, { ...prev, usedAt: Date.now() })
  return fresh
}

async function cloneInto(
  repo: string,
  identity: string,
  ref: string | undefined,
  paths: ReturnType<typeof cachePaths>,
) {
  const tmp = path.join(paths.staging, `${path.basename(paths.dir)}-${randomUUID().slice(0, 8)}`)
  await mkdir(paths.staging, { recursive: true })
  await rm(tmp, { recursive: true, force: true })
  try {
    // `--` stops git from treating the repo or ref as an option.
    await git(["clone", "--depth", "1", "--", repo, tmp])
    if (ref) {
      // A shallow clone carries only the default branch; fetch the requested ref
      // (branch or tag) and detach onto it.
      await git(["fetch", "--depth", "1", "origin", "--", ref], tmp)
      await git(["checkout", "--detach", "FETCH_HEAD"], tmp)
    }
    // Drop git metadata so the cached plugin directory is plain files.
    await rm(path.join(tmp, ".git"), { recursive: true, force: true })
    // Swap the finished clone into place so a reader never sees a half-cloned dir.
    await rm(paths.dir, { recursive: true, force: true })
    await rename(tmp, paths.dir)
    await writeMarker(paths.marker, { identity, ...(ref ? { ref } : {}), updatedAt: Date.now() })
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
 * `force: true` fetches even when the cached clone is still fresh, for an explicit plugin update.
 */
export async function resolveGitPluginTarget(
  spec: string,
  options?: { readonly refresh?: boolean; readonly force?: boolean },
): Promise<GitPluginResult> {
  const hit = parseGitPluginSpec(spec)
  const identity = gitPluginIdentity(spec)
  if (!hit || !identity)
    return { ok: false, code: "invalid_spec", error: new Error(`Invalid git plugin spec: ${spec}`) }

  const repo = repoKey(hit.repo)
  const url = cloneUrl(hit.repo)
  const paths = cachePaths(repo, hit.ref)
  try {
    await using _ = await Flock.acquire(`plugin-git:${paths.dir}`)
    const cached = options?.force ? false : await reuse(paths.dir, paths.marker, repo, hit.ref)
    if (!cached) {
      if (options?.refresh === false)
        return { ok: false, code: "not_cached", error: new Error(`Plugin clone not cached: ${spec}`) }
      await cloneInto(url, repo, hit.ref, paths)
    }
  } catch (err) {
    return { ok: false, code: "clone_failed", error: err }
  }
  if (Date.now() - collectedAt >= TTL) {
    // Cleanup must never fail a resolved plugin: a busy or unreadable entry is retried by the next sweep, so the
    // stamp only moves once a sweep completed.
    await collect().then(
      () => {
        collectedAt = Date.now()
      },
      () => undefined,
    )
  }
  return locate(spec, hit, paths.dir)
}

async function locate(spec: string, hit: GitPluginSpec, dir: string): Promise<GitPluginResult> {
  const root = await realpath(dir).catch(() => undefined)
  if (!root) return { ok: false, code: "subpath_missing", error: new Error(`Plugin clone missing for ${spec}`) }
  let target = root
  if (hit.subpath) {
    // Resolve any symlink before the containment check so a symlinked subpath cannot escape the clone.
    const resolved = await realpath(path.resolve(root, hit.subpath)).catch(() => undefined)
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
  await collectStaging(path.join(root, STAGING), now)
  const names = new Set([
    ...entries.filter((entry) => entry !== STAGING && !entry.endsWith(".json")),
    ...entries.filter((entry) => entry.endsWith(".json")).map((entry) => entry.slice(0, -".json".length)),
  ])
  await Promise.all([...names].map((name) => collectEntry(root, name, now)))
}

// A staging dir belongs to no cache entry, so its own age is the whole rule.
async function collectStaging(directory: string, now: number) {
  const entries = await readdir(directory).catch(() => [] as string[])
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry)
      const info = await stat(file).catch(() => undefined)
      if (info && now - info.mtimeMs > STAGING_RETENTION)
        await rm(file, { recursive: true, force: true }).catch(() => undefined)
    }),
  )
}

// An entry is swept only when its clone is gone or its last use is older than the retention window. The check
// runs once to pick candidates and again under the entry's lock, and nothing is removed before the lock is held,
// so a sweep cannot delete a clone or marker another process is publishing.
async function collectEntry(root: string, name: string, now: number) {
  const dir = path.join(root, name)
  const marker = path.join(root, `${name}.json`)
  if (!(await expired(dir, marker, now))) return
  const lease = await Flock.acquire(`plugin-git:${dir}`, { timeoutMs: LOCK_WAIT }).catch(() => undefined)
  // A busy entry belongs to a resolve in another process; the next sweep picks it up.
  if (!lease) return
  try {
    if (!(await expired(dir, marker, now))) return
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    await rm(marker, { force: true }).catch(() => undefined)
  } finally {
    await lease.release()
  }
}

// Only a missing directory counts as gone: any other stat failure keeps the entry. An unreadable marker ages by
// the directory, never by a missing timestamp.
async function expired(dir: string, marker: string, now: number) {
  const info = await stat(dir).then(
    (value) => value,
    (error) => (error instanceof Error && "code" in error && error.code === "ENOENT" ? null : undefined),
  )
  if (info === undefined) return false
  if (info === null) return true
  const prev: Marker | undefined = await Bun.file(marker)
    .json()
    .catch(() => undefined)
  return now - (prev?.usedAt ?? prev?.updatedAt ?? info.mtimeMs) > RETENTION
}

// The resources a local repo resolution stands for. A `plugin.use` deny on a local path is written against a
// path, so the canonical path, its real path and the caller's spelling are all named: the same repository must
// not load under a directory spelling the deny misses.
async function localResources(identity: string, local: string) {
  const canonical = path.resolve(local)
  const real = await realpath(canonical).catch(() => undefined)
  // Only absolute forms name a directory a policy can deny: `./plugins/x` is already covered by its canonical path.
  return [...new Set([identity, canonical, ...(path.isAbsolute(local) ? [local] : []), ...(real ? [real] : [])])]
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
    const local = isLocalRepo(hit.repo) ? cloneUrl(hit.repo) : undefined
    // The resources come from the spec alone, so a loader can deny the plugin before a clone reaches the network.
    const resources = local ? yield* Effect.promise(() => localResources(identity, local)) : [identity]
    const result = yield* Effect.promise(() => resolveGitPluginTarget(target, { refresh: options.install }))
    if (!result.ok) {
      if (result.code === "not_cached") return { pending: true as const, resources }
      const detail = result.error instanceof Error ? result.error.message : String(result.error)
      return yield* Effect.fail(
        new PluginModule.LoadError({ message: `Failed to resolve git plugin ${target}: ${detail}` }),
      )
    }
    return { target: result.target, resources }
  })
