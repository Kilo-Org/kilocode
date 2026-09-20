import { createSignal, type Accessor } from "solid-js"
import type { SessionContextValue } from "../../../context/session-types"
import { Identifier } from "../../../utils/id"

export function useGoalComposer(
  key: Accessor<string>,
  ops: {
    send: SessionContextValue["sendCommand"]
    fingerprint: (key: string) => string
    clear: (key: string) => void
  },
) {
  const [owner, setOwner] = createSignal<string>()
  const [requests, setRequests] = createSignal<Record<string, string>>({})
  const submitted = new Map<string, string>()
  const goal = {
    active: () => owner() === key(),
    ready: (text: string) => owner() !== key() || !!text.trim(),
    pending: (scope = key()) => Object.values(requests()).includes(scope),
    activate: () => setOwner(key()),
    cancel: () => {
      // Cancel exits composition, not the accepted backend command. Retain its draft on acknowledgement.
      for (const [id, scope] of Object.entries(requests())) {
        if (scope === key()) submitted.delete(id)
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
    send: (scope: string, stamp: string, args: Parameters<SessionContextValue["sendCommand"]>) => {
      if (key() !== scope || !goal.active() || goal.pending()) return
      const messageID = Identifier.ascending("message")
      submitted.set(messageID, stamp)
      goal.begin(messageID, scope)
      args[8] = { messageID }
      if (ops.send(...args)) return
      goal.finish(messageID, false)
    },
    begin: (id: string, scope: string) => setRequests((current) => ({ ...current, [id]: scope })),
    move: (from: string, to: string) => {
      if (owner() === from) setOwner(to)
      setRequests((current) =>
        Object.fromEntries(Object.entries(current).map(([id, scope]) => [id, scope === from ? to : scope])),
      )
    },
    finish: (id: string, success: boolean) => {
      const scope = requests()[id]
      if (!scope) return
      setRequests((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      if (success && owner() === scope) setOwner(undefined)
      if (success && submitted.get(id) === ops.fingerprint(scope)) ops.clear(scope)
      submitted.delete(id)
      return scope
    },
  }
  return goal
}
