// The sessions of the Agent Manager over the per-directory stores of the panel. A session lives in the store of its
// directory: a worktree session in the store of the worktree path, a local session in the store of the project root.
// The sidebar, the tabs and the history read the root sessions of every directory of the active project.
import type { SessionInfo } from "@opencode/client"
import { createMemo, createSignal } from "solid-js"
import type { V2 } from "../../src/v2/client"
import { sessionActivity, type Activity } from "./activity"
import type { PanelData } from "./panel-data"

export function createSessions(input: {
  panel: PanelData
  /** The directories of the active project: its root first, then its worktrees. */
  directories: () => readonly string[]
  /** The directory of a session the Agent Manager tracks, when the host state names one. */
  directoryOf: (sessionID: string) => string | undefined
}) {
  const [current, setCurrent] = createSignal<string>()
  const connected = () => input.panel.connection.status() === "connected"
  const stores = createMemo(() => input.directories().map((directory) => input.panel.store(directory)))

  // The store that has the session, else the store of its known directory, else the project root store.
  const scope = (sessionID: string): V2 | undefined => {
    const found = stores().find((item) => item.data.session.get(sessionID))
    if (found) return found
    const directory = input.directoryOf(sessionID)
    if (directory) return input.panel.store(directory)
    return stores()[0]
  }

  const sessions = createMemo(() =>
    stores()
      .flatMap((item) => item.data.session.list().filter((info) => !info.parentID))
      .toSorted((a, b) => b.time.updated - a.time.updated),
  )

  return {
    sessions,
    scope,
    get: (sessionID: string): SessionInfo | undefined => scope(sessionID)?.data.session.get(sessionID),
    currentSessionID: current,
    setCurrentSessionID: setCurrent,
    selectSession: (sessionID: string) => setCurrent(sessionID),
    clearCurrentSession: () => setCurrent(undefined),
    activityFor(sessionID: string): Activity {
      const item = scope(sessionID)
      if (!item) return "idle"
      return sessionActivity(item.data, sessionID, connected())
    },
    isSubmitting(sessionID: string) {
      const item = scope(sessionID)
      if (!item) return false
      return item.data.session.pending
        .list(sessionID)
        .some((entry) => entry.type === "user" && item.data.session.pending.status(sessionID, entry.id) === "starting")
    },
    messages(sessionID: string) {
      return scope(sessionID)?.data.session.message.list(sessionID) ?? []
    },
    loading(sessionID: string) {
      return scope(sessionID)?.data.session.message.loading(sessionID) ?? false
    },
    /** Loads a session the user did not open in a tab, for example a subagent in the inspector. */
    sync(sessionID: string) {
      const item = scope(sessionID)
      if (!item) return Promise.resolve()
      return Promise.all([item.data.session.sync(sessionID), item.data.session.message.sync(sessionID)]).then(
        () => undefined,
      )
    },
    /** Drops the loaded messages of a session the inspector no longer shows. */
    release(sessionID: string) {
      scope(sessionID)?.data.session.message.invalidate(sessionID)
    },
    interrupt(sessionID: string) {
      const item = scope(sessionID)
      if (!item) return Promise.resolve()
      return item.api.session.interrupt({ sessionID }).then(() => undefined)
    },
  }
}

export type Sessions = ReturnType<typeof createSessions>
