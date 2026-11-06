// The files a completed turn changed, kept per session and turn. A completed turn does not change, so a row that
// mounts again shows the cached files instead of asking the server. The request keeps each patch small with
// `context: 0`, and the cache keeps only the counts the row shows, never the patches.
import type { FileDiffInfo } from "@opencode/client"

export type TurnDiffQuery = { sessionID: string; from: string; context: number }

export type TurnDiffFetch = (query: TurnDiffQuery) => Promise<FileDiffInfo[]>

/** What the turn row shows for one changed file. */
export type TurnFile = { file: string; additions: number; deletions: number }

/** Turns kept at most. A long session or many tabs evict the turns used least recently. */
export const TURN_LIMIT = 200

const key = (sessionID: string, turnID: string) => `${sessionID}\u0000${turnID}`

/** A bounded cache of completed turn diffs. One instance holds every session the view shows. */
export function createTurnDiffs(limit = TURN_LIMIT) {
  const results = new Map<string, TurnFile[]>()
  const pending = new Map<string, Promise<TurnFile[]>>()
  // A Map keeps insertion order, so re-inserting on use makes the first key the least recently used one.
  const touch = (id: string, files: TurnFile[]) => {
    results.delete(id)
    results.set(id, files)
    if (results.size <= limit) return
    const oldest = results.keys().next().value
    if (oldest !== undefined) results.delete(oldest)
  }
  return {
    /** The cached files of a turn, if the row already asked for them. */
    read(sessionID: string, turnID: string) {
      const id = key(sessionID, turnID)
      const files = results.get(id)
      if (files) touch(id, files)
      return files
    },
    /**
     * Loads a turn's files once. A second row of the same turn joins the request already running, so a split assistant
     * row asks the server only once.
     */
    request(sessionID: string, turnID: string, fetch: TurnDiffFetch) {
      const id = key(sessionID, turnID)
      const cached = results.get(id)
      if (cached) {
        touch(id, cached)
        return Promise.resolve(cached)
      }
      const running = pending.get(id)
      if (running) return running
      const promise = fetch({ sessionID, from: turnID, context: 0 })
        .then((list) => {
          const files = list.map((item) => ({ file: item.file, additions: item.additions, deletions: item.deletions }))
          touch(id, files)
          return files
        })
        .finally(() => pending.delete(id))
      pending.set(id, promise)
      return promise
    },
  }
}

/** The shared cache of the sidebar and Agent Manager transcripts. */
export const turnDiffs = createTurnDiffs()
