export * as PlanFile from "./plan-file"

import type { Location } from "@opencode/schema/location"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { DateTime } from "effect"
import fs from "node:fs"
import path from "node:path"

export type Target = Pick<Location.Info, "directory" | "project">

/** Version control markers at a project root. A project without one is a plain directory, keyed by its path. */
const VCS = [".git", ".hg"]

/**
 * The Kilo plan directory: `.kilo2/plans` in a version-controlled project, else `plans` in the Kilo data
 * directory. A directory without version control has no project root to keep plans in. The project ID does not
 * tell the two apart: a plain directory gets a hashed ID, and an unidentified repository shares the global ID.
 */
export function directory(target: Target, data: string) {
  if (!VCS.some((name) => fs.existsSync(path.join(target.project.directory, name)))) return path.join(data, "plans")
  return path.join(target.project.directory, ".kilo2", "plans")
}

/** The default plan file of a session, used when the model names no path. */
export function defaultPath(session: Pick<Session.Info, "time">, target: Target, data: string) {
  return path.join(directory(target, data), `${DateTime.toEpochMillis(session.time.created)}-plan.md`)
}

/** Creates the plan directory. The directory check comes first: some Windows file systems fail a recursive mkdir. */
export function ensure(dir: string) {
  if (fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * A path the model named, or undefined when it is outside the workspace, the project and the plan directory, or
 * an existing non-file. The file may not exist yet.
 */
export function resolve(file: string | undefined, target: Target, data: string) {
  if (!file) return undefined
  const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(target.directory, file)
  if (!inside(full, target, data)) return undefined
  const stat = fs.statSync(full, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) return undefined
  return full
}

/**
 * The plan file on disk: the target, else a newer sibling with the same time prefix (the model picks the name
 * suffix), else the last plan file a planning message wrote.
 */
export function locate(
  target: string,
  messages: ReadonlyArray<SessionMessage.Info>,
  workspace: Target,
  data: string,
  agent?: string,
) {
  return saved(target) ?? written(messages, workspace, data, agent)
}

/** A path for the model and the client, relative to the session workspace when it is inside the project. */
export function display(file: string, target: Target) {
  // The project directory is canonical while the session directory can be a symlink (macOS /tmp), so compare
  // both in their real form.
  const project = real(target.project.directory)
  const directory = real(target.directory)
  const full = FSUtil.contains(target.project.directory, file)
    ? path.join(project, path.relative(target.project.directory, file))
    : FSUtil.contains(target.directory, file)
      ? path.join(directory, path.relative(target.directory, file))
      : file
  if (FSUtil.contains(project, full) || FSUtil.contains(directory, full))
    return path.relative(directory, full).replaceAll("\\", "/") || file
  return file
}

function real(dir: string) {
  return fs.existsSync(dir) ? fs.realpathSync(dir) : dir
}

const PLANNERS = new Set(["plan", "architect"])

/** True for the agents that can own a planning turn. */
export function isPlanner(agent: string | undefined) {
  return agent !== undefined && PLANNERS.has(agent.toLowerCase())
}

function inside(file: string, target: Target, data: string) {
  return (
    FSUtil.contains(target.directory, file) ||
    FSUtil.contains(target.project.directory, file) ||
    FSUtil.contains(directory(target, data), file)
  )
}

function isFile(file: string) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true
}

function saved(target: string) {
  const dir = path.dirname(target)
  const prefix = `${path.basename(target, ".md").replace(/-plan$/, "")}-`
  const files = new Set(
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".md")) : [],
  )
  // The exact target competes with generated siblings on mtime, so a stale guess cannot beat a fresher plan.
  if (isFile(target)) files.add(path.basename(target))
  return [...files]
    .flatMap((name) => {
      const file = path.join(dir, name)
      const stat = fs.statSync(file, { throwIfNoEntry: false })
      return stat?.isFile() ? [{ file, time: stat.mtimeMs }] : []
    })
    .sort((left, right) => right.time - left.time || left.file.localeCompare(right.file))[0]?.file
}

function planWrite(message: SessionMessage.Info) {
  if (message.type !== "assistant") return undefined
  for (const part of message.content.toReversed()) {
    if (part.type !== "tool" || part.state.status === "error") continue
    if (part.name !== "write" && part.name !== "edit") continue
    // A write and plan_exit can arrive in the same tool batch. Use the input path even while the write is still
    // running; the file check in `written` rejects a write that has not reached the disk.
    const input = part.state.input
    const file = typeof input === "object" && input !== null && "path" in input ? input["path"] : undefined
    if (typeof file === "string" && file.toLowerCase().endsWith(".md")) return file
  }
  return undefined
}

/** The newest .md file a planning message wrote that is still on disk and inside the plan scope. */
function written(messages: ReadonlyArray<SessionMessage.Info>, workspace: Target, data: string, agent?: string) {
  return messages
    .toReversed()
    .flatMap((message) => {
      if (message.type !== "assistant") return []
      if (!isPlanner(message.agent) && (agent === undefined || message.agent !== agent)) return []
      const file = planWrite(message)
      return file === undefined ? [] : [file]
    })
    .map((file) => (path.isAbsolute(file) ? path.normalize(file) : path.resolve(workspace.directory, file)))
    .find((file) => inside(file, workspace, data) && isFile(file))
}
