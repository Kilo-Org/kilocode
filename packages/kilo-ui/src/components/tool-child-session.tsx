import type { SessionMessageAssistantTool } from "@opencode/client"
import { createContext, useContext, type ParentProps } from "solid-js"

/**
 * Data a subagent tool card needs from the session a child started. The host owns the session store, so a card
 * renders the child list only when the host provides this context. A host without it renders the card without
 * the child list.
 */
export type ToolChildSession = {
  /** Tool parts of the child session, in message order. */
  tools: (sessionID: string) => SessionMessageAssistantTool[]
  /** Whether the child session is still running. */
  running: (sessionID: string) => boolean
  /** Request the child session history. Must be safe to call repeatedly for one session. */
  load: (sessionID: string) => void
}

const Context = createContext<ToolChildSession>()

export function ToolChildSessionProvider(props: ParentProps<{ value: ToolChildSession }>) {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>
}

export function useToolChildSession() {
  return useContext(Context)
}
