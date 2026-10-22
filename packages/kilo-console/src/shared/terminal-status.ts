/**
 * Global reactive store for per-project terminal status.
 *
 * State is organized as Map<projectId, Set<sessionId>> for each category.
 * Any component can read or write to this store — it is the single source of
 * truth for the status indicators shown in the rail and in the terminal list.
 *
 * Population sources:
 *   - SSE events wired up once in AppSidebar (cross-project + initial hydration)
 *   - ProjectConsoleRoute (same-project events + message-level unread tracking)
 */

import { createSignal } from "solid-js"
import type { ProjectItem } from "../client"

// ─── types ────────────────────────────────────────────────────────────────────

export type ProjectStatus = "error" | "attention" | "unread" | "busy" | "idle"

const PRIORITY: ProjectStatus[] = ["error", "attention", "unread", "busy", "idle"]

// ─── internal signals (Map<projectId, Set<sessionId>>) ────────────────────────

const [_errors, setErrors] = createSignal(new Map<string, Set<string>>())
const [_attention, setAttention] = createSignal(new Map<string, Set<string>>())
const [_unread, setUnread] = createSignal(new Map<string, Set<string>>())
const [_busy, setBusy] = createSignal(new Map<string, Set<string>>())

// ─── helpers ──────────────────────────────────────────────────────────────────

function addSession(
  setter: (fn: (m: Map<string, Set<string>>) => Map<string, Set<string>>) => void,
  projectId: string,
  sessionId: string,
) {
  setter((m) => {
    if (m.get(projectId)?.has(sessionId)) return m
    const next = new Map(m)
    next.set(projectId, new Set([...(m.get(projectId) ?? []), sessionId]))
    return next
  })
}

function removeSession(
  setter: (fn: (m: Map<string, Set<string>>) => Map<string, Set<string>>) => void,
  projectId: string,
  sessionId: string,
) {
  setter((m) => {
    const sessions = m.get(projectId)
    if (!sessions?.has(sessionId)) return m
    const next = new Map(m)
    const s = new Set(sessions)
    s.delete(sessionId)
    if (s.size === 0) next.delete(projectId)
    else next.set(projectId, s)
    return next
  })
}

function removeProject(
  setter: (fn: (m: Map<string, Set<string>>) => Map<string, Set<string>>) => void,
  projectId: string,
) {
  setter((m) => {
    if (!m.has(projectId)) return m
    const next = new Map(m)
    next.delete(projectId)
    return next
  })
}

// ─── public API ───────────────────────────────────────────────────────────────

// error
export const markError = (p: string, s: string) => addSession(setErrors, p, s)
export const clearError = (p: string, s: string) => removeSession(setErrors, p, s)
export const clearErrorProject = (p: string) => removeProject(setErrors, p)

// attention
export const markAttention = (p: string, s: string) => addSession(setAttention, p, s)
export const clearAttention = (p: string, s: string) => removeSession(setAttention, p, s)
export const clearAttentionProject = (p: string) => removeProject(setAttention, p)

// unread
export const markUnread = (p: string, s: string) => addSession(setUnread, p, s)
export const clearUnread = (p: string, s: string) => removeSession(setUnread, p, s)
export const clearUnreadProject = (p: string) => removeProject(setUnread, p)

// busy
export const markBusy = (p: string, s: string) => addSession(setBusy, p, s)
export const clearBusy = (p: string, s: string) => removeSession(setBusy, p, s)
export const clearBusyProject = (p: string) => removeProject(setBusy, p)

// ─── derived per-project status (reactive) ────────────────────────────────────

export function projectStatus(projectId: string): ProjectStatus {
  if ((_errors().get(projectId)?.size ?? 0) > 0) return "error"
  if ((_attention().get(projectId)?.size ?? 0) > 0) return "attention"
  if ((_unread().get(projectId)?.size ?? 0) > 0) return "unread"
  if ((_busy().get(projectId)?.size ?? 0) > 0) return "busy"
  return "idle"
}

export function sessionHasUnread(projectId: string, sessionId: string) {
  return _unread().get(projectId)?.has(sessionId) ?? false
}

// ─── path helpers (reused from client.ts pattern) ─────────────────────────────

function norm(input: string) {
  return input.replace(/\\/g, "/").replace(/\/+$/, "") || "/"
}

function inside(root: string, dir: string) {
  const r = norm(root)
  const d = norm(dir)
  return d === r || d.startsWith(`${r}/`)
}

export function projectForDir(items: ProjectItem[], dir: string): ProjectItem | undefined {
  let best: ProjectItem | undefined
  let bestLen = -1
  for (const item of items) {
    for (const root of [item.worktree, ...item.sandboxes]) {
      if (inside(root, dir)) {
        const len = norm(root).length
        if (len > bestLen) {
          bestLen = len
          best = item
        }
      }
    }
  }
  return best
}

// ─── event parsing ────────────────────────────────────────────────────────────

export type GlobalEvent = {
  directory: string
  project?: string
  payload: unknown
}

export function eventTypeName(event: GlobalEvent): string {
  const payload = event.payload as { type?: string; name?: unknown; syncEvent?: { type?: unknown } }
  if (!payload.type) return ""
  if (payload.type !== "sync") return payload.type
  if (typeof payload.name === "string") return payload.name
  if (typeof (payload.syncEvent as Record<string, unknown> | undefined)?.type === "string")
    return (payload.syncEvent as { type: string }).type
  return ""
}

export function eventSessionId(event: GlobalEvent): string | undefined {
  const payload = event.payload as Record<string, unknown>
  const props = (payload.properties ?? payload.data) as Record<string, unknown> | undefined
  const id = props?.sessionID
  return typeof id === "string" ? id : undefined
}

// priority helpers for composing status
export { PRIORITY }
