// The sessions of the Agent Manager over the per-directory stores of the panel. A session lives in the store of its
// directory: a worktree session in the store of the worktree path, a local session in the store of the project root.
// The sidebar, the tabs and the history read the root sessions of every directory of the active project.
import type { SessionInfo } from "@opencode/client"
import { createMemo, createSignal } from "solid-js"
import type { V2 } from "../../src/v2/scope"
import { sessionActivity, type Activity } from "./activity"
import { key, type PanelData } from "./panel-data"

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

  // A store can also load a session of another directory, when an event about it reaches that store. The session
  // belongs to the store of its own directory.
  const owns = (item: V2, info: SessionInfo) => key(info.location.directory) === item.directory

  // The store of the session's directory, else the store of its known directory, else the project root store.
  const scope = (sessionID: string): V2 | undefined => {
    const holders = stores().flatMap((item) => {
      const info = item.data.session.get(sessionID)
      return info ? [{ item, info }] : []
    })
    const found = (holders.find((entry) => owns(entry.item, entry.info)) ?? holders[0])?.item
    if (found) return found
    const directory = input.directoryOf(sessionID)
    if (directory) return input.panel.store(directory)
    return stores()[0]
  }

  // One entry per session: the copy of its own store, else the first store that has it.
  const sessions = createMemo(() => {
    const result = new Map<string, SessionInfo>()
    for (const item of stores())
      for (const info of item.data.session.list()) {
        if (info.parentID) continue
        if (!result.has(info.id) || owns(item, info)) result.set(info.id, info)
      }
    return [...result.values()].toSorted((a, b) => b.time.updated - a.time.updated)
  })

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
    /** Drops the loaded session and its messages when the inspector no longer shows it. */
    release(sessionID: string) {
      scope(sessionID)?.data.session.evict(sessionID)
    },
    interrupt(sessionID: string) {
      const item = scope(sessionID)
      if (!item) return Promise.resolve()
      return item.api.session.interrupt({ sessionID }).then(() => undefined)
    },
  }
}

export type Sessions = ReturnType<typeof createSessions>
