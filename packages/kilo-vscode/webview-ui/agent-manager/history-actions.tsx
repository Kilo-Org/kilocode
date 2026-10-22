/** @jsxImportSource solid-js */

import type { JSX } from "solid-js"
import type { LanguageContextValue } from "../src/context/language"
import type { SessionInfo } from "../src/types/messages"
import { SessionRowActions } from "./SessionRowActions"

/**
 * Per-row actions for the Agent Manager sessions view.
 * `onLocal` and `onPromote` close over the app's scoped-project handlers.
 */
export function historyRowActions(opts: {
  t: LanguageContextValue["t"]
  onPromote: (sessionId: string) => void
  onLocal: (sessionId: string) => void
}): (entry: SessionInfo) => JSX.Element {
  return (entry) => (
    <SessionRowActions t={opts.t} onWorktree={() => opts.onPromote(entry.id)} onLocal={() => opts.onLocal(entry.id)} />
  )
}
