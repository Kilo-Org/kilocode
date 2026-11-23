import { createSignal, type Accessor } from "solid-js"
import type { SessionContextValue } from "../../../context/session-types"
import { Identifier } from "../../../utils/id"

interface Request {
  scope: string
  /** The conversation the sent message actually targets, captured at send time.
   * May differ from `scope` (a draft key) and from whatever conversation is
   * active by the time the backend responds. */
  historyKey?: string
}

export function useGoalComposer(
  key: Accessor<string>,
  ops: {
    send: SessionContextValue["sendCommand"]
    fingerprint: (key: string) => string
    clear: (key: string, historyKey?: string) => void
  },
) {
  const [owner, setOwner] = createSignal<string>()
  const [requests, setRequests] = createSignal<Record<string, Request>>({})
  const submitted = new Map<string, string>()
  const goal = {
    active: () => owner() === key(),
    ready: (text: string) => owner() !== key() || !!text.trim(),
    pending: (scope = key()) => Object.values(requests()).some((r) => r.scope === scope),
    activate: () => setOwner(key()),
    cancel: () => {
      // Cancel exits composition, not the accepted backend command. Retain its draft on acknowledgement.
      for (const [id, r] of Object.entries(requests())) {
        if (r.scope === key()) submitted.delete(id)
      }
      setOwner(undefined)
    },
    prepare: (draft: string, reset: () => void) => {
      if (goal.pending()) return false
      if (!goal.active() && draft === "/goal") {
        goal.activate()
        reset()
        return false
      }
      return goal.ready(draft)
    },
    send: (scope: string, stamp: string, args: Parameters<SessionContextValue["sendCommand"]>, historyKey?: string) => {
      if (key() !== scope || !goal.active() || goal.pending()) return
      const messageID = Identifier.ascending("message")
      submitted.set(messageID, stamp)
      goal.begin(messageID, scope, historyKey)
      args[8] = { messageID }
      if (ops.send(...args)) return
      goal.finish(messageID, false)
    },
    begin: (id: string, scope: string, historyKey?: string) =>
      setRequests((current) => ({ ...current, [id]: { scope, historyKey } })),
    move: (from: string, to: string, historyKey?: string) => {
      if (owner() === from) setOwner(to)
      setRequests((current) =>
        Object.fromEntries(
          Object.entries(current).map(([id, r]) =>
            r.scope === from ? [id, { scope: to, historyKey: historyKey ?? r.historyKey }] : [id, r],
          ),
        ),
      )
    },
    finish: (id: string, success: boolean) => {
      const request = requests()[id]
      if (!request) return
      const { scope, historyKey } = request
      setRequests((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      if (success && owner() === scope) setOwner(undefined)
      if (success && submitted.get(id) === ops.fingerprint(scope)) ops.clear(scope, historyKey)
      submitted.delete(id)
      return scope
    },
  }
  return goal
}
