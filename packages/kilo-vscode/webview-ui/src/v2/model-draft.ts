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
  // Replace the record instead of merging: a Default pick has no variant field and must not keep the previous one.
  const write = (sessionID: string, value: ModelRef | undefined) =>
    setDrafts((all) => ({ ...all, [sessionID]: value }))
  return {
    get(sessionID: string) {
      return drafts()[sessionID]
    },
    /** A choice equal to the session's own model leaves no draft, so the composer shows the session again. */
    set(sessionID: string, next: ModelRef, current: ModelRef | undefined) {
      write(sessionID, sameModel(next, current) ? undefined : next)
    },
    /** Drops the draft once the session reports the same model, for example the echo of its commit. */
    settle(sessionID: string, current: ModelRef | undefined) {
      if (sameModel(drafts()[sessionID], current)) write(sessionID, undefined)
    },
  }
}

function sameModel(a: ModelRef | undefined, b: ModelRef | undefined) {
  if (!a || !b) return false
  return a.providerID === b.providerID && a.id === b.id && (a.variant ?? DEFAULT) === (b.variant ?? DEFAULT)
}
