import { monotonicFactory } from "ulid"
import type { IngestQueue } from "./ingest-queue"

export namespace StatusSync {
  export type Status = Extract<IngestQueue.Data, { type: "session_status" }>["data"]
  export type Derived = Pick<Status, "status" | "scheduledAt">

  export function create() {
    const entries = new Map<string, Status | undefined>()
    const next = monotonicFactory()

    function record(sessionID: string, derived: Derived, occurredAt?: string): Status {
      const previous = entries.get(sessionID)
      const value =
        previous?.status === derived.status
          ? { ...previous, ...derived }
          : occurredAt === undefined
            ? derived
            : {
                ...derived,
                occurredAt,
                previousStatus: previous?.status ?? null,
                transitionId: next(),
              }
      entries.set(sessionID, value)
      return value
    }

    async function snapshot(sessionID: string, derive: () => Promise<Derived>): Promise<Status> {
      // A placeholder lets a deletion during the async read be observed even without a prior entry.
      if (!entries.has(sessionID)) entries.set(sessionID, undefined)
      const previous = entries.get(sessionID)
      try {
        const derived = await derive()
        if (!entries.has(sessionID)) return derived
        const current = entries.get(sessionID)
        // An event observed during the async snapshot is newer than its sampled state.
        if (current !== previous) return current ?? derived
        return record(sessionID, derived)
      } finally {
        if (entries.has(sessionID) && entries.get(sessionID) === undefined) entries.delete(sessionID)
      }
    }

    return {
      record,
      snapshot,
      delete: (sessionID: string) => entries.delete(sessionID),
    }
  }
}
