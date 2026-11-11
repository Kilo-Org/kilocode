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
  // A pick is kept even when it matches the stored model: that model lags a commit in flight, so clearing against it
  // would drop a later pick the moment the older echo lands. The echo of the model that was committed clears instead.
  return {
    get(sessionID: string) {
      return drafts()[sessionID]
    },
    set(sessionID: string, next: ModelRef) {
      setDrafts((all) => ({ ...all, [sessionID]: next }))
    },
    /** Drops the draft once the session reports the same model, for example the echo of its commit. */
    settle(sessionID: string, current: ModelRef | undefined) {
      if (!sameModel(drafts()[sessionID], current)) return
      setDrafts((all) => remove(all, sessionID))
    },
    /** Drops the draft of a deleted session, so the record stays bounded by live sessions. */
    drop(sessionID: string) {
      setDrafts((all) => remove(all, sessionID))
    },
  }
}

function remove(all: Record<string, ModelRef | undefined>, sessionID: string) {
  if (!(sessionID in all)) return all
  const rest = { ...all }
  delete rest[sessionID]
  return rest
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined) {
  if (!a || !b) return false
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? DEFAULT) === (b.variant ?? DEFAULT)
}
