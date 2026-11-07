export * as AgentRemove from "./remove.js"

import { containsDirectory } from "@opencode/util/path"
import path from "path"

export type Scope = "global" | "project"

/** A config directory with its filesystem-resolved form, used to decide whether deleting inside it is allowed. */
export type Candidate = { readonly root: string; readonly resolved: string }

/**
 * An allowed config directory. `reference` is the resolved project or global config directory the deletion must stay
 * inside, so a symlink below the root cannot widen deletion any more than a symlinked root can.
 */
export type Root = {
  readonly root: string
  readonly reference: string
  readonly scope: Scope
}

export type AgentPath = { readonly name: string; readonly path: string; readonly scope: Scope }

/** A discovered file and the resolved location of its directory entry. */
export type Discovered = { readonly file: string; readonly real: string }

export type Failure = "not_found" | "not_removable"

/** The config agent plugin's discovery patterns, kept in sync with its `legacySources`. */
export const patterns = ["{agent,agents}/**/*.md", "{mode,modes}/*.md"] as const

/** The id the config agent plugin derives from a discovered file. */
export function documentID(root: string, file: string) {
  return path
    .relative(path.resolve(root), path.resolve(file))
    .replaceAll("\\", "/")
    .replace(/^(agent|agents|mode|modes)\//, "")
    .replace(/\.md$/, "")
}

/** Whether the config agent plugin would discover this file under `root`, at the depth it scans it. */
export function isAgentFile(root: string, file: string) {
  const relative = path.relative(path.resolve(root), path.resolve(file)).replaceAll("\\", "/")
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".md")) return false
  const segments = relative.split("/")
  const directory = segments.at(0)
  // `{agent,agents}/**` is recursive; `{mode,modes}/*` is one level deep.
  if (directory === "agent" || directory === "agents") return segments.length > 1
  if (directory === "mode" || directory === "modes") return segments.length === 2
  return false
}

/**
 * The config directories a removal may delete from, with the scope each is reported under. Only a directory that
 * resolves inside the project or inside the global config directory qualifies, so a project `.kilo2` that is a
 * symlink to `/` resolves outside both and never becomes a deletion root. The filesystem root is never a root, and
 * the managed system directory is excluded from the project scope as the settings writer also excludes it.
 */
export function roots(candidates: readonly Candidate[], directory: string, global: string, system?: string) {
  const references = {
    project: path.resolve(directory),
    home: path.resolve(global),
    system: system === undefined ? undefined : path.resolve(system),
  }
  const result: Root[] = []
  for (const item of candidates) {
    if (path.parse(item.resolved).root === item.resolved) continue
    const scope = scopeOf(item, references)
    if (scope === undefined) continue
    if (result.some((entry) => entry.root === item.root)) continue
    result.push({ root: item.root, reference: scope === "global" ? references.home : references.project, scope })
  }
  return result
}

function scopeOf(
  candidate: Candidate,
  references: { readonly project: string; readonly home: string; readonly system?: string },
): Scope | undefined {
  if (containsDirectory(references.home, candidate.resolved)) return "global"
  if (references.system !== undefined && containsDirectory(references.system, candidate.resolved)) return undefined
  return containsDirectory(references.project, candidate.resolved) ? "project" : undefined
}

/**
 * The agents a removal may delete: files the config agent plugin would discover, inside a known root. `real` is the
 * resolved location of the file's directory entry, so a symlinked directory below the root cannot point a deletion
 * outside the project or the global config directory. A symlinked file stays the entry itself, so it is deleted as
 * the link and never through to its target.
 */
export function agents(files: readonly Discovered[], known: readonly Root[]): AgentPath[] {
  const result: AgentPath[] = []
  for (const item of files) {
    const root = known.find((entry) => isAgentFile(entry.root, item.file))
    if (!root) continue
    if (!containsDirectory(root.reference, item.real)) continue
    result.push({ name: documentID(root.root, item.file), path: item.real, scope: root.scope })
  }
  return result
}

/** A stable order for the removable list; glob order follows the filesystem. */
export function compare(a: AgentPath, b: AgentPath) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.path === b.path) return 0
  return a.path < b.path ? -1 : 1
}

/**
 * The files a removal deletes for `name`, or why it may not. A name the registry knows but that no markdown file
 * defines is a built-in or another agent kind, so the removal is refused rather than reported as unknown.
 */
export function target(input: {
  name: string
  known: readonly AgentPath[]
  registered: readonly string[]
  scope?: Scope
}): { _tag: "target"; files: string[] } | { _tag: "failure"; reason: Failure } {
  const matches = input.known.filter(
    (agent) => agent.name === input.name && (input.scope === undefined || agent.scope === input.scope),
  )
  if (matches.length > 0) return { _tag: "target", files: [...new Set(matches.map((agent) => agent.path))] }
  // A file in another scope means the requested scope simply has no definition; a registered agent with no file
  // anywhere is a built-in or another agent kind, which is refused instead of reported as unknown.
  if (input.known.some((agent) => agent.name === input.name)) return { _tag: "failure", reason: "not_found" }
  if (input.registered.includes(input.name)) return { _tag: "failure", reason: "not_removable" }
  return { _tag: "failure", reason: "not_found" }
}
