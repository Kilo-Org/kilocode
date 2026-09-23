/**
 * Request cost notices. After a request: live notices for model requests
 * whose reported cost reaches the Request Cost Notice threshold. Costs come
 * from step-finish parts, one per model request. Assistant message costs can
 * also hold subagent spend, so they are not used here. Before a request: a
 * warning when a model or reasoning change will resend the context without
 * cache.
 */

import { createSignal } from "solid-js"
import type { ExtensionMessage, Part } from "../types/messages"

/** Default USD threshold. 0 disables the notice. */
export const NOTICE_THRESHOLD = 1

export type CostNotice = { id: string; sessionID: string; cost: number; end: number }

/** Read the threshold from extension settings. */
export function noticeThreshold(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : NOTICE_THRESHOLD
}

type Model = { providerID: string; modelID: string }

export type CacheReset = { kind: "model" | "variant"; tokens: number; cost: number }

/**
 * Warn before a request that cannot use the prompt cache. A different model
 * never shares a cache. On Anthropic models a different thinking or effort
 * setting also invalidates the cached messages. The cost is an estimate:
 * the session context at the input price of the next model.
 */
export function cacheReset(input: {
  last?: Model & { variant?: string }
  next?: Model
  variant?: string
  tokens: number
  price?: number
  threshold: number
}): CacheReset | undefined {
  const last = input.last
  const next = input.next
  if (!last || !next || !input.price || !(input.threshold > 0)) return undefined
  const model = last.providerID !== next.providerID || last.modelID !== next.modelID
  const variant =
    (last.variant ?? "") !== (input.variant ?? "") && /anthropic|claude/i.test(`${next.providerID}/${next.modelID}`)
  if (!model && !variant) return undefined
  const cost = (input.tokens * input.price) / 1_000_000
  if (cost < input.threshold) return undefined
  return { kind: model ? "model" : "variant", tokens: input.tokens, cost }
}

/**
 * Track notices from live part updates. Parts that finished before `since`
 * (history, replays after a reload) never produce a notice. Each part
 * produces at most one notice, and a dismissed notice does not return.
 */
export function createCostNotices(threshold: () => number, since = Date.now()) {
  const seen = new Set<string>()
  const [notices, setNotices] = createSignal<Record<string, CostNotice>>({})

  function add(sessionID: string, part: Part) {
    if (part.type !== "step-finish" || seen.has(part.id)) return
    const limit = threshold()
    if (!(limit > 0) || typeof part.cost !== "number" || part.cost < limit) return
    if (!part.time || part.time.end < since) return
    seen.add(part.id)
    const notice = { id: part.id, sessionID, cost: part.cost, end: part.time.end }
    setNotices((prev) => ({ ...prev, [sessionID]: notice }))
  }

  function handle(message: ExtensionMessage) {
    if (message.type === "partUpdated") add(message.sessionID, message.part)
    if (message.type === "partsUpdated") message.updates.forEach((item) => add(item.sessionID, item.part))
  }

  /** Latest notice for the session `id` or any of its subagent sessions. */
  function latest(id: string | undefined, family: (id: string) => Set<string>) {
    if (!id) return undefined
    const ids = family(id)
    return Object.values(notices())
      .filter((item) => ids.has(item.sessionID))
      .sort((a, b) => b.end - a.end)
      .at(0)
  }

  function dismiss(id: string) {
    setNotices((prev) => Object.fromEntries(Object.entries(prev).filter(([, item]) => item.id !== id)))
  }

  return { handle, latest, dismiss }
}
