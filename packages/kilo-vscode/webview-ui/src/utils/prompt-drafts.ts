import { partFeedback } from "../../../src/shared/browser-feedback"
import type { SendMessageFailedMessage } from "../types/messages"

export function composePromptMessage(parts: {
  review: string
  browser: string
  annotations: string
  draft: string
}): string {
  return [parts.review, parts.browser, parts.annotations, parts.draft].filter(Boolean).join("\n\n")
}

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

interface PromptDraftLookupStores {
  text: ReadonlyMap<string, unknown>
  comments: ReadonlyMap<string, unknown>
  images: ReadonlyMap<string, unknown>
  scrolls: ReadonlyMap<string, unknown>
  browsers?: ReadonlyMap<string, unknown>
  annotations?: ReadonlyMap<string, unknown>
  editors?: ReadonlyMap<string, unknown>
}

export function promptDraftStorageKey(raw: string, fallback: string, stores: PromptDraftLookupStores): string {
  const suffix = `:${raw}`
  const maps: ReadonlyMap<string, unknown>[] = [stores.text, stores.comments, stores.images, stores.scrolls]
  if (stores.browsers) maps.push(stores.browsers)
  if (stores.annotations) maps.push(stores.annotations)
  if (stores.editors) maps.push(stores.editors)
  for (const map of maps) {
    for (const key of map.keys()) {
      if (key.endsWith(suffix)) return key
    }
  }
  return scopeDraftKey(fallback, raw)
}

export function promptDraftPromotion(
  raw: string,
  sessionID: string,
  fallback: string,
  stores: PromptDraftLookupStores,
) {
  const suffix = `:${raw}`
  const source = promptDraftStorageKey(raw, fallback, stores)
  const box = source.slice(0, -suffix.length)
  return { source, target: scopeDraftKey(box, sessionDraftKey(sessionID)) }
}

export function movePromptDraft<T, C, I, S, B, A, E>(
  stores: {
    text: Map<string, T>
    comments: Map<string, C>
    images: Map<string, I>
    scrolls: Map<string, S>
    browsers?: Map<string, B>
    annotations?: Map<string, A>
    editors?: Map<string, E>
  },
  source: string,
  target: string,
): { text?: T; comments?: C; images?: I; scroll?: S; browsers?: B; annotations?: A; editor?: E } {
  const draft = {
    text: stores.text.get(source),
    comments: stores.comments.get(source),
    images: stores.images.get(source),
    scroll: stores.scrolls.get(source),
    ...(stores.browsers?.has(source) ? { browsers: stores.browsers.get(source) } : {}),
    ...(stores.annotations?.has(source) ? { annotations: stores.annotations.get(source) } : {}),
    ...(stores.editors?.has(source) ? { editor: stores.editors.get(source) } : {}),
  }
  const move = <V>(map: Map<string, V> | undefined, value: V | undefined) => {
    if (value !== undefined && !map?.has(target)) map?.set(target, value)
    map?.delete(source)
  }
  move(stores.text, draft.text)
  move(stores.comments, draft.comments)
  move(stores.images, draft.images)
  move(stores.scrolls, draft.scroll)
  move(stores.browsers, draft.browsers)
  move(stores.annotations, draft.annotations)
  move(stores.editors, draft.editor)
  return draft
}
