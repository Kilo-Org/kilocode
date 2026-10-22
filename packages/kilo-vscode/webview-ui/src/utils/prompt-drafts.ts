import type { SendMessageFailedMessage } from "../types/messages"

export function failedPrompt(failed: Pick<SendMessageFailedMessage, "text">) {
  return { text: failed.text }
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

export function createdDraftKey(draftID?: string): string | undefined {
  return pendingDraftKey(draftID)
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

export function movePromptDraft<T, I, S, P, X>(
  stores: {
    text: Map<string, T>
    images: Map<string, I>
    scrolls: Map<string, S>
    pastes?: Map<string, P>
    contexts?: Map<string, X>
  },
  source: string,
  target: string,
): { text?: T; images?: I; scroll?: S; pastes?: P; contexts?: X } {
  const hasPastes = stores.pastes?.has(source) ?? false
  const hasContexts = stores.contexts?.has(source) ?? false
  const pastes = stores.pastes ? move(stores.pastes, source, target, true) : undefined
  const contexts = stores.contexts ? move(stores.contexts, source, target, true) : undefined
  return {
    text: move(stores.text, source, target, false),
    images: move(stores.images, source, target, false),
    scroll: move(stores.scrolls, source, target, false),
    ...(hasPastes ? { pastes } : {}),
    ...(hasContexts ? { contexts } : {}),
  }
}
