import { createSignal, onCleanup, onMount } from "solid-js"
import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionMessage } from "@opencode/schema/session-message"
import { HostedReview } from "@opencode/schema/kilocode/hosted-review"
import type { ChatRoute } from "./route"

type State = {
  comments: readonly HostedReview.Comment[]
  overall: string
  destinationID: string
  messageID?: string
  status?: HostedReview.Delivery["status"]
}
const empty = (): State => ({ comments: [], overall: "", destinationID: "" })
const drafts = new WeakMap<OpenCodeClient, Map<string, State>>()

export function reviewDraft(api: OpenCodeClient, route: ChatRoute) {
  const target = route.target,
    key = JSON.stringify([route.directory, target.scope, target.workspaceID, target.sessionID])
  const cache = drafts.get(api) ?? new Map<string, State>()
  drafts.set(api, cache)
  const [state, setState] = createSignal(cache.get(key) ?? empty())
  const [busy, setBusy] = createSignal(false)
  const [choices, setChoices] = createSignal<readonly { sessionID: string; title: string }[]>([])
  const [loading, setLoading] = createSignal(false),
    [failed, setFailed] = createSignal(false)
  const life = new AbortController()
  let storageKey: string | undefined
  onCleanup(() => life.abort())
  const rpc = api.rpc(KiloHostedRpc.Definition),
    options = { location: { directory: route.directory }, signal: life.signal }
  function update(next: State) {
    if (!cache.has(key) && cache.size >= 24) cache.delete(cache.keys().next().value!)
    cache.set(key, next)
    setState(next)
    if (!storageKey) return
    try {
      if (next.comments.length) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch {
      /* Session-memory drafts still work when storage is unavailable. */
    }
  }
  const locked = () => busy() || !!state().messageID
  function edit(patch: Partial<Pick<State, "comments" | "overall" | "destinationID">>) {
    if (!locked()) update({ ...state(), ...patch, status: undefined })
  }
  async function load() {
    if (loading() || life.signal.aborted) return
    setLoading(true)
    setFailed(false)
    setChoices([])
    try {
      const r = await rpc.reviewDestinations({ target }, options)
      if (life.signal.aborted) return
      setChoices(r.items)
      if (r.draftKey && !storageKey) {
        storageKey = `kilo.cloud.review.v1.${r.draftKey}`
        // Only an authorized source/owner lookup grants access to the persisted draft. Never auto-submit it.
        if (state().comments.length) update(state())
        else {
          const saved = HostedReview.readSavedDraft(localStorage.getItem(storageKey))
          if (saved._tag === "Some") update(saved.value)
        }
      }
    } catch {
      if (!life.signal.aborted) setFailed(true)
    } finally {
      setLoading(false)
    }
  }
  onMount(() => void load())
  async function dispatch() {
    const s = state()
    if (busy() || !s.destinationID || !s.comments.length) return
    if (!s.messageID && !choices().some((r) => r.sessionID === s.destinationID)) return
    const messageID = s.messageID ?? SessionMessage.ID.create(),
      input = { target, destinationID: s.destinationID, messageID }
    setBusy(true)
    update({ ...s, messageID, status: "unknown" })
    try {
      const result = s.messageID
        ? await rpc.reviewDelivery(input, options)
        : await rpc.sendReview(
            { ...input, draft: { comments: s.comments, ...(s.overall.trim() && { overall: s.overall.trim() }) } },
            options,
          )
      if (life.signal.aborted) return
      if (result.status === "accepted") update({ ...empty(), status: "accepted" })
      else update({ ...s, status: result.status, messageID: result.status === "unknown" ? messageID : undefined })
    } catch {
      /* Keep the durable id frozen. Only an explicit receipt check may follow an ambiguous send. */
    } finally {
      setBusy(false)
    }
  }
  return { state, locked, busy, choices, loading, failed, edit, load, dispatch }
}
export type ReviewDraft = ReturnType<typeof reviewDraft>
