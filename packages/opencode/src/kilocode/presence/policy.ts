import {
  MAX_ATTACHED_PER_VIEWER,
  MAX_SESSION_ID_LENGTH,
  MAX_VISIBLE_PER_VIEWER,
  MAX_VISIBLE_SESSIONS,
  VIEWER_TTL_MS,
  cliSessionContext,
  platformContext,
  type Platform,
} from "./context"

export type ViewerSnapshot = {
  viewer: { id: string; active: boolean }
  attached: readonly string[]
  visible: readonly string[]
}

export type ViewerState = {
  id: string
  active: boolean
  attached: string[]
  visible: string[]
  lastSeen: number
}

export type ValidationError =
  | { kind: "missing_viewer" }
  | { kind: "bad_viewer_id" }
  | { kind: "attached_too_many" }
  | { kind: "visible_too_many" }
  | { kind: "bad_session_id"; id: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validSessionId(sid: unknown): boolean {
  return typeof sid === "string" && sid.startsWith("ses") && sid.length <= MAX_SESSION_ID_LENGTH
}

// Deduplicate preserving first-seen order.
export function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

type ValidationResult =
  | { ok: true; viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }
  | { ok: false; error: ValidationError }

export function validateSnapshot(input: {
  viewer?: { id?: unknown; active?: unknown }
  attached?: unknown
  visible?: unknown
}): ValidationResult {
  const v = input.viewer
  if (!v || typeof v !== "object") return { ok: false, error: { kind: "missing_viewer" } }
  const id = v.id
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: { kind: "bad_viewer_id" } }

  const rawAttached: readonly unknown[] = Array.isArray(input.attached) ? input.attached : []
  const rawVisible: readonly unknown[] = Array.isArray(input.visible) ? input.visible : []

  // Reject on raw input size first to bound dedupe work.
  if (rawAttached.length > MAX_ATTACHED_PER_VIEWER) return { ok: false, error: { kind: "attached_too_many" } }
  if (rawVisible.length > MAX_VISIBLE_PER_VIEWER) return { ok: false, error: { kind: "visible_too_many" } }

  for (const sid of rawAttached) {
    if (!validSessionId(sid)) {
      return { ok: false, error: { kind: "bad_session_id", id: typeof sid === "string" ? sid : String(sid) } }
    }
  }
  for (const sid of rawVisible) {
    if (!validSessionId(sid)) {
      return { ok: false, error: { kind: "bad_session_id", id: typeof sid === "string" ? sid : String(sid) } }
    }
  }

  return {
    ok: true,
    viewer: { id, active: v.active === true },
    attached: dedupe(rawAttached as readonly string[]),
    visible: dedupe(rawVisible as readonly string[]),
  }
}

// Union of every viewer's attached ids (retained regardless of active).
export function attachedUnion(viewers: readonly ViewerState[]): string[] {
  const all: string[] = []
  for (const v of viewers) all.push(...v.attached)
  return dedupe(all)
}

// Union of ACTIVE viewers' visible ids, deduped and lexicographically capped at
// MAX_VISIBLE_SESSIONS. Returns the retained ids and how many were omitted.
export function visibleUnion(viewers: readonly ViewerState[]): { ids: string[]; omitted: number } {
  const all: string[] = []
  for (const v of viewers) {
    if (!v.active) continue
    all.push(...v.visible)
  }
  const union = dedupe(all)
  union.sort()
  const retained = union.slice(0, MAX_VISIBLE_SESSIONS)
  return { ids: retained, omitted: union.length - retained.length }
}

// Viewer ids expired at `now` (now >= lastSeen + VIEWER_TTL_MS).
export function expiredViewerIds(viewers: readonly ViewerState[], now: number): string[] {
  const out: string[] = []
  for (const v of viewers) {
    if (now >= v.lastSeen + VIEWER_TTL_MS) out.push(v.id)
  }
  return out
}

// Earliest upcoming expiry deadline strictly greater than `now`, or undefined.
export function nextExpiryDeadline(viewers: readonly ViewerState[], now: number): number | undefined {
  let min: number | undefined
  for (const v of viewers) {
    const deadline = v.lastSeen + VIEWER_TTL_MS
    if (deadline <= now) continue
    if (min === undefined || deadline < min) min = deadline
  }
  return min
}

// Reconcile desired Event Service contexts: removals first, then additions.
export function reconcileContexts(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>,
): { remove: string[]; add: string[] } {
  const remove: string[] = []
  const add: string[] = []
  for (const c of prev) if (!next.has(c)) remove.push(c)
  for (const c of next) if (!prev.has(c)) add.push(c)
  return { remove, add }
}

// Desired Event Service context set for a platform and the capped visible ids.
// The platform context is published only when at least one viewer is active.
export function desiredContexts(platform: Platform, active: boolean, visibleIds: readonly string[]): Set<string> {
  const out = new Set<string>()
  if (active) out.add(platformContext(platform))
  for (const id of visibleIds) out.add(cliSessionContext(id))
  return out
}
