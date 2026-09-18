import type { Disp, Proc } from "#pty"
import path from "node:path"
import { Log } from "../../util/log"
import type { Location } from "../../location"
import type { Info } from "../../pty"
import type { PtyID } from "../../pty/schema"
import { KiloPtyTermination } from "./termination"

const log = Log.create({ service: "pty.registry" })

export type Subscriber = {
  readonly onData: (chunk: string) => void
  readonly onEnd: (event: { exitCode?: number }) => void
  active: boolean
  detached: boolean
  pending: string[]
  end?: { exitCode?: number }
}

export type Active = {
  info: Info
  location: Location.Ref
  process: Proc
  buffer: string
  bufferCursor: number
  cursor: number
  subscribers: Map<object, Subscriber>
  listeners: Disp[]
  stopping: boolean
  terminated: boolean
  closing?: Promise<void>
}

export const sessions = new Map<PtyID, Active>()
const exited = new Map<string, PtyID[]>()
const pending = new Map<number, Location.Ref>()
const blocked = new Map<string, Location.Ref>()
const removing = new Set<PtyID>()
const waiters = new Set<() => void>()
const directoryTasks = new Map<string, Promise<void>>()
let next = 0
let closing = false
let shutdownTask: Promise<void> | undefined
let owners = 0

export function sameLocation(a: Location.Ref, b: Location.Ref) {
  return sameDirectory(a.directory, b.directory) && a.workspaceID === b.workspaceID
}

export function sameDirectory(a: string, b: string) {
  const left = directoryKey(a)
  const right = directoryKey(b)
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function directoryKey(value: string) {
  return path.resolve(value)
}

function locationKey(location: Location.Ref) {
  const directory = directoryKey(location.directory)
  return `${location.workspaceID ?? ""}\u0000${process.platform === "win32" ? directory.toLowerCase() : directory}`
}

function matchesDirectory(location: Location.Ref, target: Location.Ref) {
  return sameDirectory(location.directory, target.directory) && location.workspaceID === target.workspaceID
}

function wake() {
  const current = [...waiters]
  waiters.clear()
  for (const resolve of current) resolve()
}

function waitFor(check: () => boolean): Promise<void> {
  if (check()) return Promise.resolve()
  return new Promise<void>((resolve) => waiters.add(resolve)).then(() => waitFor(check))
}

export function beginCreate(location: Location.Ref) {
  if (closing) throw new Error("PTY registry is shutting down")
  for (const target of blocked.values()) {
    if (matchesDirectory(location, target)) throw new Error("PTY directory is being removed")
  }
  const id = ++next
  pending.set(id, location)
  let released = false
  return () => {
    if (released) return
    released = true
    pending.delete(id)
    wake()
  }
}

export function claimRemoval(id: PtyID) {
  if (removing.has(id)) return false
  removing.add(id)
  return true
}

export function releaseRemoval(id: PtyID) {
  removing.delete(id)
}

export async function acquireOwner() {
  if (shutdownTask) await shutdownTask.catch(() => undefined)
  owners++
  let released = false
  return async () => {
    if (released) return
    released = true
    owners--
    if (owners === 0) await shutdown()
  }
}

export function hasDirectory(location: Location.Ref) {
  return Array.from(sessions.values()).some((session) => matchesDirectory(session.location, location))
}

export function markExited(session: Active) {
  const key = locationKey(session.location)
  const order = exited.get(key) ?? []
  if (!exited.has(key)) exited.set(key, order)
  order.push(session.info.id)
}

export function oldestExited(location: Location.Ref) {
  return exited.get(locationKey(location))?.[0]
}

export function exitedCount(location: Location.Ref) {
  return exited.get(locationKey(location))?.length ?? 0
}

export function removeExitedID(location: Location.Ref, id: PtyID) {
  const key = locationKey(location)
  const order = exited.get(key)
  if (!order) return
  const index = order.indexOf(id)
  if (index !== -1) order.splice(index, 1)
  if (order.length === 0) exited.delete(key)
}

export function removeExited(session: Active) {
  removeExitedID(session.location, session.info.id)
}

function notifyEnd(session: Active, event: { exitCode?: number }) {
  for (const subscriber of session.subscribers.values()) {
    if (!subscriber.active) {
      subscriber.end = event
      continue
    }
    try {
      subscriber.onEnd(event)
    } catch (error) {
      log.debug("PTY subscriber end callback failed", { error, id: session.info.id })
    }
  }
  session.subscribers.clear()
}

export function teardown(session: Active) {
  if (session.closing) return session.closing
  const task = (async () => {
    session.stopping = true
    try {
      if (!session.terminated && session.info.status !== "exited") {
        await KiloPtyTermination.terminate(session.process)
      }
      session.terminated = true
      for (const listener of session.listeners) listener.dispose()
      session.listeners.length = 0
      notifyEnd(session, session.info.status === "exited" ? { exitCode: session.info.exitCode } : {})
    } catch (error) {
      session.stopping = false
      throw error
    }
  })()
  session.closing = task
  void task.catch(() => {
    if (session.closing === task) session.closing = undefined
  })
  return task
}

async function teardownMany(owned: Active[]) {
  const results = await Promise.allSettled(owned.map(teardown))
  const failed: unknown[] = []
  for (let index = 0; index < owned.length; index++) {
    const session = owned[index]
    const result = results[index]
    if (!session || !result) continue
    if (result.status === "rejected") {
      failed.push(result.reason)
      continue
    }
    if (sessions.get(session.info.id) !== session) continue
    sessions.delete(session.info.id)
    removeExited(session)
  }
  if (failed.length > 0) throw new AggregateError(failed, "Failed to tear down one or more PTYs")
}

export function shutdown() {
  if (shutdownTask) return shutdownTask
  const task = (async () => {
    closing = true
    let success = false
    try {
      await waitFor(() => pending.size === 0)
      await teardownMany(Array.from(sessions.values()))
      success = true
    } finally {
      closing = false
      wake()
    }
  })()
  shutdownTask = task
  void task.then(
    () => {
      if (shutdownTask === task) shutdownTask = undefined
    },
    () => {
      if (shutdownTask === task) shutdownTask = undefined
    },
  )
  return task
}

async function terminateDirectoryOnce(target: Location.Ref) {
  const key = locationKey(target)
  blocked.set(key, target)
  let success = false
  try {
    await waitFor(() => ![...pending.values()].some((location) => matchesDirectory(location, target)))
    const owned = Array.from(sessions.values()).filter((session) => matchesDirectory(session.location, target))
    await teardownMany(owned)
    success = true
  } finally {
    if (success) blocked.delete(key)
    wake()
  }
}

export function terminateDirectory(target: Location.Ref) {
  const key = locationKey(target)
  const current = directoryTasks.get(key)
  if (current) return current
  const task = terminateDirectoryOnce(target)
  directoryTasks.set(key, task)
  void task.then(
    () => {
      if (directoryTasks.get(key) === task) directoryTasks.delete(key)
    },
    (error) => {
      log.warn("failed to tear down PTY for directory", { error, target })
      if (directoryTasks.get(key) === task) directoryTasks.delete(key)
    },
  )
  return task
}
