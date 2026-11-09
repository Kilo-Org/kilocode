export * as PlanFile from "./plan-file"

import type { Location } from "@opencode/schema/location"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { DateTime } from "effect"
import fs from "node:fs"
import path from "node:path"

/** The project directory that holds Kilo plan files. */
const DIRECTORY = path.join(".kilo2", "plans")

type Target = Pick<Location.Info, "directory" | "project">

export function directory(target: Target) {
  return path.join(target.project.directory, DIRECTORY)
}

/** The default plan file of a session, used when the plan tool names no path. */
export function defaultPath(session: Pick<Session.Info, "time">, target: Target) {
  return path.join(directory(target), `${DateTime.toEpochMillis(session.time.created)}-plan.md`)
}

/**
 * A workspace path the tool named, or undefined when it is outside the project and the workspace, or an
 * existing non-file. The file may not exist yet.
 */
export function resolve(file: string | undefined, target: Target, base = target.directory, roots: readonly string[] = []) {
  if (!file) return undefined
  const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(base, file)
  if (!inside(full, target, roots)) return undefined
  const stat = fs.statSync(full, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) return undefined
  return full
}

/**
 * The plan file on disk: the target itself, else a newer sibling the planning turn wrote with a generated
 * name, else the last plan file a planning message wrote.
 */
export function locate(
  target: string,
  messages: ReadonlyArray<SessionMessage.Info>,
  workspace: Target,
  agent?: string,
  roots: readonly string[] = [],
) {
  return saved(target) ?? written(messages, target, workspace, agent, roots) ?? recent(target, roots)
}

/** A path for the model and the client, relative to the session workspace when it is inside the project. */
export function display(file: string, target: Target) {
  if (FSUtil.contains(target.project.directory, file) || FSUtil.contains(target.directory, file))
    return path.relative(target.directory, file).replaceAll("\\", "/") || file
  return file
}

function inside(file: string, target: Target, roots: readonly string[] = []) {
  return (
    FSUtil.contains(target.directory, file) ||
    FSUtil.contains(target.project.directory, file) ||
    roots.some((root) => FSUtil.contains(root, file))
  )
}

function isFile(file: string) {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true
}

function saved(target: string) {
  const dir = path.dirname(target)
  const prefix = `${path.basename(target, ".md").replace(/-plan$/, "")}-`
  const files = new Set(
    fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".md"))
      : [],
  )
  // The exact target competes with generated siblings on mtime, so a stale guess cannot beat a fresher plan.
  if (isFile(target)) files.add(path.basename(target))
  const newest = [...files]
    .flatMap((name) => {
      const file = path.join(dir, name)
      const stat = fs.statSync(file, { throwIfNoEntry: false })
      return stat?.isFile() ? [{ file, time: stat.mtimeMs }] : []
    })
    .sort((left, right) => right.time - left.time || left.file.localeCompare(right.file))[0]
  return newest?.file
}

const PLANNERS = new Set(["plan", "architect"])

/** True for the agents that can own a planning turn. */
export function isPlanner(agent: string | undefined) {
  return agent !== undefined && PLANNERS.has(agent.toLowerCase())
}

function planWrite(message: SessionMessage.Info) {
  if (message.type !== "assistant") return undefined
  if (!isPlanner(message.agent)) return undefined
  for (const part of message.content.toReversed()) {
    if (part.type !== "tool" || part.state.status === "error") continue
    if (part.name !== "write" && part.name !== "edit") continue
    // A write and plan_exit can arrive in the same tool batch. Use the input path even while the write
    // is still running, and let the file check below reject a write that has not reached the disk.
    const input = part.state.input
    const file = typeof input === "object" && input !== null && "path" in input ? input["path"] : undefined
    if (typeof file === "string" && file.toLowerCase().endsWith(".md")) return file
  }
  return undefined
}

/** The newest .md file a planning message wrote that is still on disk. */
function written(
  messages: ReadonlyArray<SessionMessage.Info>,
  target: string,
  workspace: Target,
  agent?: string,
  roots: readonly string[] = [],
) {
  const candidates = messages.toReversed().flatMap((message) => {
    if (message.type !== "assistant") return []
    if (!isPlanner(message.agent) && (agent === undefined || message.agent !== agent)) return []
    const file = planWrite(message)
    return file === undefined ? [] : [file]
  })
  const dir = path.dirname(target)
  for (const file of candidates) {
    const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(workspace.directory, file)
    if (!inside(full, workspace, roots) && !FSUtil.contains(dir, full)) continue
    if (isFile(full)) return full
  }
  return undefined
}

/** The newest plan file in the target directory or a native plan root, for a write that has no message yet. */
function recent(target: string, roots: readonly string[]) {
  const directories = [path.dirname(target), ...roots]
  return directories
    .flatMap((directory) => {
      if (!fs.existsSync(directory)) return []
      return fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(".md"))
        .flatMap((name) => {
          const file = path.join(directory, name)
          const stat = fs.statSync(file, { throwIfNoEntry: false })
          return stat?.isFile() ? [{ file, time: stat.mtimeMs }] : []
        })
    })
    .sort((left, right) => right.time - left.time || left.file.localeCompare(right.file))[0]?.file
}
