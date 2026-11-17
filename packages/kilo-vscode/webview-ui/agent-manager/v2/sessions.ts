// The sessions of the Agent Manager over the per-directory stores of the panel. A session lives in the store of its
// directory: a worktree session in the store of the worktree path, a local session in the store of the project root.
// The sidebar, the tabs and the history read the root sessions of the directories whose stores are shown.
import type { SessionInfo } from "@opencode/client"
import { createEffect, createMemo, createSignal, untrack } from "solid-js"
import type { V2 } from "../../src/v2/scope"
import { activityOf, sessionActivity, type Activity, type Outcome } from "./activity"
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
  const project = createMemo(() => input.directories().map((directory) => input.panel.store(directory)))

  // Sessions loaded outside the tab strip, such as a subagent in the inspector. One can move itself to a directory the
  // project does not track (the session_move tool); its later events reach only that directory's store, so the store
  // joins the lookup. Every store that loaded the session applies the move, so a project store knows the destination.
  const [watched, setWatched] = createSignal<ReadonlySet<string>>(new Set())
  const followed = createMemo<readonly string[]>((previous) => {
    const known = new Set(project().map((item) => item.directory))
    const next = new Set<string>()
    for (const id of watched())
      for (const item of project()) {
        const directory = item.data.session.get(id)?.location.directory
        if (directory && !known.has(key(directory))) next.add(key(directory))
      }
    const result = [...next].toSorted()
    return result.length === previous.length && result.every((item, index) => item === previous[index])
      ? previous
      : result
  }, [])
  const stores = createMemo(() => [...project(), ...followed().map((directory) => input.panel.store(directory))])

  // A store can also load a session of another directory, when an event about it reaches that store. The session
  // belongs to the store of its own directory.
  const owns = (item: V2, info: SessionInfo) => key(info.location.directory) === item.directory

  // The owning store of each loaded session. The map changes only when a session appears, disappears, or moves, so a
  // session record update does not invalidate every scope lookup.
  // A copy in another store still names the session's directory, and only that directory's store receives its
  // events, so the session belongs to that store even before it loaded the session itself.
  const owners = createMemo<Map<string, V2>>((previous) => {
    const next = new Map<string, V2>()
    const homes = new Map(stores().map((item) => [item.directory, item]))
    for (const item of stores())
      for (const info of item.data.session.list()) {
        const home = homes.get(key(info.location.directory))
        if (home) next.set(info.id, home)
        else if (!next.has(info.id)) next.set(info.id, item)
      }
    if (previous.size === next.size) {
      let same = true
      for (const [id, item] of next)
        if (previous.get(id) !== item) {
          same = false
          break
        }
      if (same) return previous
    }
    return next
  }, new Map())

  // The store of the session's directory, else the store of its known directory, else the project root store. A
  // directory whose store is not shown yet is not created here: its session list would load for nothing.
  const scope = (sessionID: string): V2 | undefined => {
    const found = owners().get(sessionID)
    if (found) return found
    const directory = input.directoryOf(sessionID)
    const existing = directory ? input.panel.find(directory) : undefined
    return existing ?? stores()[0]
  }

  // A followed directory is shown and loaded, then the watched sessions that moved there read from its store. It
  // stays out of the session list below: its other sessions do not belong to this project.
  const loaded = new Set<string>()
  createEffect(() => {
    const extra = followed()
    if (extra.length === 0) return
    untrack(() => input.panel.show(extra))
    for (const id of watched()) {
      const item = owners().get(id)
      if (!item || !extra.includes(item.directory) || item.data.session.get(id)) continue
      const mark = `${item.directory}\n${id}`
      if (loaded.has(mark)) continue
      loaded.add(mark)
      untrack(() => {
        void Promise.all([item.data.session.sync(id), item.data.session.message.sync(id)]).catch(() =>
          loaded.delete(mark),
        )
      })
    }
  })

  // One entry per session: the copy of its own store, else the first store that has it.
  const sessions = createMemo(() => {
    const result = new Map<string, SessionInfo>()
    for (const item of project())
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
    activityFor(sessionID: string, info?: Outcome): Activity {
      const item = scope(sessionID)
      if (!item) return info ? activityOf(info) : "idle"
      const live = sessionActivity(item.data, sessionID, connected(), item.scheduled(sessionID))
      // Without a loaded session record the store only knows live events; the host catalog keeps the finished state.
      // A loaded record already decided the outcome, including a staged revert that the catalog may not know yet.
      return live === "idle" && info && !item.data.session.get(sessionID) ? activityOf(info) : live
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
      setWatched((previous) => new Set([...previous, sessionID]))
      const item = scope(sessionID)
      if (!item) return Promise.resolve()
      return Promise.all([item.data.session.sync(sessionID), item.data.session.message.sync(sessionID)]).then(
        () => undefined,
      )
    },
    /** Drops the loaded session and its messages when the inspector no longer shows it. */
    release(sessionID: string) {
      scope(sessionID)?.data.session.message.evict(sessionID)
      setWatched((previous) => new Set([...previous].filter((id) => id !== sessionID)))
      for (const mark of [...loaded]) if (mark.endsWith(`\n${sessionID}`)) loaded.delete(mark)
    },
    /** Directories outside the project that a watched session moved to; their stores must stay alive. */
    followed,
    interrupt(sessionID: string) {
      const item = scope(sessionID)
      if (!item) return Promise.resolve()
      return item.api.session.interrupt({ sessionID }).then(() => undefined)
    },
  }
}

export type Sessions = ReturnType<typeof createSessions>
