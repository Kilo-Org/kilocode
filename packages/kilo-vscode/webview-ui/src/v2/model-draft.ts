import type { ModelRef } from "@opencode/client"
import { createSignal } from "solid-js"

// The server reports and accepts "no explicit variant" as "default" (core session/info.ts).
const DEFAULT = "default"

/**
 * The composer's model and reasoning effort for the next prompt of each session, as the TUI session draft
 * (packages/tui/src/context/local.tsx). A pick or Shift+Tab changes only the draft, so the selector follows at once
 * and a burst of presses never loses one. The next prompt commits it with switchModel, and the session reporting the
 * same model drops it.
 */
export function createModelDrafts() {
  const [drafts, setDrafts] = createSignal<Record<string, ModelRef | undefined>>({})
  // The model a started commit will produce. The stored model still reports the model before it until the echo, so a
  // pick that matches the stored model is a real change back and must not be cleared while this is pending.
  const pending = new Map<string, string>()
  return {
    get(sessionID: string) {
      return drafts()[sessionID]
    },
    /**
     * Records a pick. A pick equal to the session's own model leaves no draft, so the composer follows the session
     * again, unless a commit is in flight: then that is a change back to the model the commit is replacing.
     */
    set(sessionID: string, next: ModelRef, current: ModelRef | undefined) {
      if (pending.has(sessionID) || !sameModel(next, current)) return write(setDrafts, sessionID, next)
      clear(setDrafts, sessionID)
    },
    /** Marks the commit a prompt started, so an equal pick made while it runs is kept. */
    commit(sessionID: string, next: ModelRef) {
      pending.set(sessionID, key(next))
    },
    /** A commit that failed never produces an echo, so it must not keep blocking an equal pick. */
    failed(sessionID: string, next: ModelRef) {
      if (pending.get(sessionID) === key(next)) pending.delete(sessionID)
    },
    /** Drops the draft once the session reports the same model, for example the echo of its commit. */
    settle(sessionID: string, current: ModelRef | undefined) {
      if (!current) return
      if (pending.get(sessionID) === key(current)) pending.delete(sessionID)
      if (sameModel(drafts()[sessionID], current)) clear(setDrafts, sessionID)
    },
    /** Drops the draft of a deleted session, so the record stays bounded by live sessions. */
    drop(sessionID: string) {
      pending.delete(sessionID)
      clear(setDrafts, sessionID)
    },
  }
}

type Drafts = Record<string, ModelRef | undefined>
type SetDrafts = (update: (all: Drafts) => Drafts) => void

function write(setDrafts: SetDrafts, sessionID: string, next: ModelRef) {
  setDrafts((all) => ({ ...all, [sessionID]: next }))
}

function clear(setDrafts: SetDrafts, sessionID: string) {
  setDrafts((all) => {
    if (!(sessionID in all)) return all
    const rest = { ...all }
    delete rest[sessionID]
    return rest
  })
}

function key(model: ModelRef) {
  return `${model.providerID}/${model.id}/${model.variant ?? DEFAULT}`
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined) {
  if (!a || !b) return false
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? DEFAULT) === (b.variant ?? DEFAULT)
}
