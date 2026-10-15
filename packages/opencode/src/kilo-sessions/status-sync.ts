import { monotonicFactory } from "ulid"
import type { IngestQueue } from "./ingest-queue"

export namespace StatusSync {
  export type Status = Extract<IngestQueue.Data, { type: "session_status" }>["data"]
  export type Derived = Pick<Status, "status" | "scheduledAt">

  export function create() {
    const entries = new Map<string, Status | undefined>()
    // Counts records that carry an onset, i.e. real transitions rather than peer samples of live state.
    const transitions = new Map<string, number>()
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
      if (occurredAt !== undefined) transitions.set(sessionID, (transitions.get(sessionID) ?? 0) + 1)
      entries.set(sessionID, value)
      return value
    }

    async function sample(
      sessionID: string,
      derive: () => Promise<Derived>,
      superseded: (previous: Status | undefined) => boolean,
    ): Promise<Status> {
      // A placeholder lets a deletion during the async read be observed even without a prior entry.
      if (!entries.has(sessionID)) entries.set(sessionID, undefined)
      const previous = entries.get(sessionID)
      try {
        const derived = await derive()
        if (!entries.has(sessionID)) return derived
        if (superseded(previous)) return entries.get(sessionID) ?? derived
        return record(sessionID, derived)
      } finally {
        if (entries.has(sessionID) && entries.get(sessionID) === undefined) entries.delete(sessionID)
      }
    }

    return {
      record,
      // A peer sample of live state yields to anything recorded while it ran.
      snapshot: (sessionID: string, derive: () => Promise<Derived>) =>
        sample(sessionID, derive, (previous) => entries.get(sessionID) !== previous),
      // An event sample yields only to a real transition, so a peer full sync cannot discard the
      // status the event observed.
      event: (sessionID: string, derive: () => Promise<Derived>) => {
        const seq = transitions.get(sessionID) ?? 0
        return sample(sessionID, derive, () => (transitions.get(sessionID) ?? 0) !== seq)
      },
      delete: (sessionID: string) => {
        entries.delete(sessionID)
        transitions.delete(sessionID)
      },
    }
  }
}
