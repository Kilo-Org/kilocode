// kilocode_change - new file

/**
 * Committed product-surface map for the docs-sync bot.
 *
 * The surfaces are data, not a list hard-coded in a function: this module only
 * knows how to read `.github/docs-sync/surfaces.json` and answer which surface
 * a doc path or source path belongs to. Edit the JSON to change the map.
 *
 * A doc path belongs to at most one surface. `surfaceForDoc` and
 * `surfaceForSource` therefore return exactly one name: the surface whose
 * configured prefix is the longest match (ties broken by file order in
 * `surfaces.json`), or `other` when nothing matches. Longest-match lets a
 * specific prefix (the per-platform `code-with-ai/platforms/vscode/` pages)
 * beat the broad `code-with-ai/` prefix owned by `cli`. `other` is always last
 * in `surfaceNames` so PR creation/reporting is deterministic.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Absolute path to the committed surface map. */
export const SURFACE_MAP_PATH = path.join(HERE, "surfaces.json")

/** Name of the catch-all surface. */
export const OTHER = "other"

/**
 * Branch prefix for a per-surface docs-sync PR. The rolling integration branch
 * is exactly `docs/auto-sync` (no trailing segment) and has no PR of its own,
 * so a head that starts with this prefix is a product/`other` surface PR.
 */
export const SURFACE_BRANCH_PREFIX = "docs/auto-sync/"

/** Branch name for a surface PR. */
export function surfaceBranch(name) {
  return `${SURFACE_BRANCH_PREFIX}${name}`
}

/** The prefix that marks a per-surface branch. */
export function surfaceBranchPrefix() {
  return SURFACE_BRANCH_PREFIX
}

/**
 * The surface name encoded in a per-surface branch, or `null` when `ref` is not
 * one. A surface branch must start with `SURFACE_BRANCH_PREFIX` and carry a
 * non-empty segment after it, so the bare integration branch `docs/auto-sync`
 * and a legacy dated branch `docs/auto-sync-2026-09-11` both return `null`.
 */
export function surfaceNameFromBranch(ref) {
  const head = String(ref ?? "")
  if (!head.startsWith(SURFACE_BRANCH_PREFIX)) return null
  const name = head.slice(SURFACE_BRANCH_PREFIX.length)
  return name.length > 0 ? name : null
}

/** True when `ref` is one of this job's per-surface branches. */
export function isSurfaceBranch(ref) {
  return surfaceNameFromBranch(ref) !== null
}

/** Normalize a repo-relative path for prefix matching. */
function norm(file) {
  return String(file ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
}

function names(map) {
  return [...(map?.surfaces ?? []).map((s) => s.name), map?.other?.name ?? OTHER]
}

/**
 * Load the surface map from JSON. Defaults to the committed map; the `file`
 * argument exists so tests can point at a copy.
 */
export function loadSurfaceMap(file = SURFACE_MAP_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

/** Surface names in file order with `other` last. */
export function surfaceNames(map) {
  return names(map)
}

/** Doc path prefixes assigned to `name` (empty for `other` unless configured). */
export function surfaceDocPrefixes(name, map) {
  if (name === (map?.other?.name ?? OTHER)) return map?.other?.docs ?? []
  return (map?.surfaces ?? []).find((s) => s.name === name)?.docs ?? []
}

/**
 * Normalize one `sources` entry to `{ prefix, repo }`.
 *
 * A bare string is a prefix in THIS repository; an object keeps its `repo`
 * (`repo: null` or missing also means this repository). This is what lets the
 * committed bare-string `sources` keep working while a cloud surface names the
 * repository whose git history ranks its reviewers.
 */
export function sourceEntry(entry) {
  if (typeof entry === "string") return { prefix: entry, repo: null }
  return { prefix: entry?.prefix, repo: entry?.repo ?? null }
}

/** Normalized `{ prefix, repo }` source entries for `name` (empty for `other`). */
export function surfaceSourceEntries(name, map) {
  if (name === (map?.other?.name ?? OTHER)) return []
  const sources = (map?.surfaces ?? []).find((s) => s.name === name)?.sources ?? []
  return sources.map(sourceEntry)
}

/** Unique non-null source repos for `name`, in first-seen order (empty for `other`). */
export function surfaceSourceRepos(name, map) {
  const repos = []
  for (const entry of surfaceSourceEntries(name, map)) {
    if (entry.repo && !repos.includes(entry.repo)) repos.push(entry.repo)
  }
  return repos
}

/**
 * Source path prefixes used for git-history ranking (empty for `other`).
 * Kept as a string list so callers that only print or match prefixes are
 * unaffected by repo-qualified entries; use `surfaceSourceEntries` for the
 * repo each prefix belongs to.
 */
export function surfaceSourcePrefixes(name, map) {
  return surfaceSourceEntries(name, map).map((e) => e.prefix)
}

/** Configured reviewers for `name`; product surfaces compute theirs at runtime. */
export function surfaceReviewers(name, map) {
  if (name === (map?.other?.name ?? OTHER)) return map?.other?.reviewers ?? []
  return (map?.surfaces ?? []).find((s) => s.name === name)?.reviewers ?? []
}

/** The explicit doc prefixes that fall to `other`, for printing in PR bodies. */
export function otherDocPrefixes(map) {
  return map?.other?.docs ?? []
}

/** The derivation sentence, for printing in PR bodies. */
export function derivation(map) {
  return map?.derivation ?? ""
}

/**
 * Exactly one surface name for a path: the surface whose configured prefix in
 * `key` ("docs" or "sources") is the longest match, ties broken by surface
 * order in the map, falling back to `other` when no prefix matches.
 */
function longestMatch(file, map, key) {
  const f = norm(file)
  let name = map?.other?.name ?? OTHER
  let len = -1
  for (const s of map?.surfaces ?? []) {
    for (const raw of s[key] ?? []) {
      const p = norm(sourceEntry(raw).prefix)
      if (p.length > len && f.startsWith(p)) {
        name = s.name
        len = p.length
      }
    }
  }
  return name
}

/** Exactly one surface name for a doc path. */
export function surfaceForDoc(file, map = loadSurfaceMap()) {
  return longestMatch(file, map, "docs")
}

/** Exactly one surface name for a source path. */
export function surfaceForSource(file, map = loadSurfaceMap()) {
  return longestMatch(file, map, "sources")
}

/**
 * Group files by the surface their doc path belongs to. Preserves input order
 * inside each group; groups are ordered by `surfaceNames` (file order, `other`
 * last). Empty groups are omitted.
 */
export function groupBySurface(files, map) {
  const order = surfaceNames(map)
  const buckets = new Map(order.map((name) => [name, []]))
  for (const file of Array.isArray(files) ? files : []) {
    const name = surfaceForDoc(file, map)
    const bucket = buckets.get(name)
    if (bucket) bucket.push(file)
  }
  const out = new Map()
  for (const name of order) {
    const bucket = buckets.get(name)
    if (bucket && bucket.length > 0) out.set(name, bucket)
  }
  return out
}
