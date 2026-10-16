import { partFeedback } from "../../../src/shared/browser-feedback"
import type { SendMessageFailedMessage } from "../types/messages"

export function failedPrompt(failed: Pick<SendMessageFailedMessage, "text" | "review" | "browserFeedback">) {
  if (!failed.review && !failed.browserFeedback) return { text: failed.text, comments: [], browsers: [] }
  const parsed = partFeedback({ kilo: { review: failed.review, browserFeedback: failed.browserFeedback } }, failed.text)
  if (!parsed) return undefined
  return {
    text: parsed.body,
    comments: parsed.review?.comments ?? [],
    browsers: parsed.browserFeedback?.references ?? [],
  }
}

export function sessionDraftKey(id?: string): string | undefined {
  if (!id) return undefined
  return `session:${id}`
}

export function pendingDraftKey(id?: string): string | undefined {
  if (!id) return undefined
  if (id.startsWith("pending:")) return id
  return `pending:${id}`
}

export function scopeDraftKey(box: string, raw?: string): string {
  if (!raw) return `${box}:empty`
  return `${box}:${raw}`
}

export function createdDraftKey(draftID?: string, sandbox = false): string | undefined {
  return pendingDraftKey(draftID) ?? (sandbox ? "new" : undefined)
}

const routes = new Map<string, string>()

export function promotePromptDraft(box: string, pending: string, session: string): void {
  const source = pendingDraftKey(pending)
  const target = sessionDraftKey(session)
  if (!source || !target) return
  routes.set(scopeDraftKey(box, source), target)
}

export function promptDraftKey(
  box: string,
  id?: string,
  state?: { draft?: string; current?: string },
): string | undefined {
  if (!id) return undefined
  const pending = pendingDraftKey(id)
  const alias = pending && routes.get(scopeDraftKey(box, pending))
  if (alias) return scopeDraftKey(box, alias)
  const raw =
    id.startsWith("pending:") || id.startsWith("sidebar-pending:") || (id === state?.draft && id !== state?.current)
      ? pending
      : sessionDraftKey(id)
  return scopeDraftKey(box, raw)
}

export function clearPromptDraftRoutes(id?: string): void {
  if (id === undefined) {
    routes.clear()
    return
  }
  const pending = pendingDraftKey(id)
  const session = sessionDraftKey(id)
  for (const [key, value] of routes) {
    if ((pending && key.endsWith(`:${pending}`)) || value === session) routes.delete(key)
  }
}

/**
 * Move one draft value from `source` to `target`. Required stores never
 * overwrite an existing target value; optional stores do.
 */
function move<V>(map: Map<string, V>, source: string, target: string, overwrite: boolean): V | undefined {
  const value = map.get(source)
  if (value === undefined) return undefined
  if (overwrite || !map.has(target)) map.set(target, value)
  map.delete(source)
  return value
}

export function movePromptDraft<T, C, I, S, B, P, X>(
  stores: {
    text: Map<string, T>
    comments: Map<string, C>
    images: Map<string, I>
    scrolls: Map<string, S>
    browsers?: Map<string, B>
    pastes?: Map<string, P>
    contexts?: Map<string, X>
  },
  source: string,
  target: string,
): { text?: T; comments?: C; images?: I; scroll?: S; browsers?: B; pastes?: P; contexts?: X } {
  const hasBrowsers = stores.browsers?.has(source) ?? false
  const hasPastes = stores.pastes?.has(source) ?? false
  const hasContexts = stores.contexts?.has(source) ?? false
  const browsers = stores.browsers ? move(stores.browsers, source, target, true) : undefined
  const pastes = stores.pastes ? move(stores.pastes, source, target, true) : undefined
  const contexts = stores.contexts ? move(stores.contexts, source, target, true) : undefined
  return {
    text: move(stores.text, source, target, false),
    comments: move(stores.comments, source, target, false),
    images: move(stores.images, source, target, false),
    scroll: move(stores.scrolls, source, target, false),
    ...(hasBrowsers ? { browsers } : {}),
    ...(hasPastes ? { pastes } : {}),
    ...(hasContexts ? { contexts } : {}),
  }
}
