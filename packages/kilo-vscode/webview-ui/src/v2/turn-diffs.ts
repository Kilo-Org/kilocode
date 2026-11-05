// The files a completed turn changed, kept per session and turn. A completed turn does not change, so a row that
// mounts again shows the cached files instead of asking the server. The request keeps each patch small with
// `context: 0`, because the row only needs the file count and the change bars.
import type { FileDiffInfo } from "@opencode/client"

export type TurnDiffQuery = { sessionID: string; from: string; context: number }

export type TurnDiffFetch = (query: TurnDiffQuery) => Promise<FileDiffInfo[]>

const key = (sessionID: string, turnID: string) => `${sessionID}\u0000${turnID}`

/** A cache of completed turn diffs. One instance holds every session the view shows. */
export function createTurnDiffs() {
  const results = new Map<string, FileDiffInfo[]>()
  const pending = new Map<string, Promise<FileDiffInfo[]>>()
  return {
    /** The cached files of a turn, if the row already asked for them. */
    read(sessionID: string, turnID: string) {
      return results.get(key(sessionID, turnID))
    },
    /**
     * Loads a turn's files once. A second row of the same turn joins the request already running, so a split assistant
     * row asks the server only once.
     */
    request(sessionID: string, turnID: string, fetch: TurnDiffFetch) {
      const id = key(sessionID, turnID)
      const cached = results.get(id)
      if (cached) return Promise.resolve(cached)
      const running = pending.get(id)
      if (running) return running
      const promise = fetch({ sessionID, from: turnID, context: 0 })
        .then((files) => {
          results.set(id, files)
          return files
        })
        .finally(() => pending.delete(id))
      pending.set(id, promise)
      return promise
    },
  }
}

/** The shared cache of the sidebar transcript. */
export const turnDiffs = createTurnDiffs()
