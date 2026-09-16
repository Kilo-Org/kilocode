import { Effect, Option, PubSub, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Event, type Payload } from "@opencode-ai/schema/event"
import type { Database } from "../database/database"
import { InvalidDurableEventError, type Interface, type Subscriber } from "../event"
import { EventSequenceTable, EventTable } from "../event/sql"
import { Location } from "../location"
import * as EventStorage from "./event-storage"

const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input)

export function make(input: {
  readonly db: Database.Interface["db"]
  readonly projectors: ReadonlyMap<string, readonly Subscriber[]>
  readonly durable: ReadonlyMap<string, ReadonlySet<PubSub.PubSub<void>>>
  readonly notify: (event: Payload, isolate: boolean) => Effect.Effect<void>
}): Interface["publishAll"] {
  return (entries, options) =>
    Effect.gen(function* () {
      if (entries.length === 0) return
      const context = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
      const location =
        options?.location ?? (context ? { directory: context.directory, workspaceID: context.workspaceID } : undefined)
      const sequences = new Map<string, number>()
      const pending = new Array<Payload>()
      const rows = new Array<typeof EventTable.$inferInsert>()

      yield* input.db
        .transaction(
          () =>
            Effect.gen(function* () {
              for (const entry of entries) {
                const event: Payload = {
                  id: options?.id ?? Event.ID.create(),
                  ...(options?.metadata ? { metadata: options.metadata } : {}),
                  type: entry.definition.type,
                  ...(location ? { location } : {}),
                  data: entry.data,
                }
                const durable = entry.definition.durable
                if (!durable) {
                  if (options?.commit)
                    throw new InvalidDurableEventError({
                      type: event.type,
                      message: "Local commit hooks require a durable event",
                    })
                  pending.push(event)
                  continue
                }
                const aggregate = record(event.data) ? event.data[durable.aggregate] : undefined
                if (typeof aggregate !== "string")
                  throw new InvalidDurableEventError({
                    type: event.type,
                    message: `Expected string aggregate field ${durable.aggregate}`,
                  })
                const latest =
                  sequences.get(aggregate) ??
                  (yield* input.db
                    .select({ seq: EventSequenceTable.seq })
                    .from(EventSequenceTable)
                    .where(eq(EventSequenceTable.aggregate_id, aggregate))
                    .get()
                    .pipe(Effect.orDie))?.seq ??
                  -1
                const seq = latest + 1
                const encoded = EventStorage.encode(
                  entry.definition.type,
                  Schema.encodeUnknownSync(entry.definition.data)(event.data),
                )
                if (!record(encoded))
                  throw new InvalidDurableEventError({
                    type: event.type,
                    message: "Expected object durable event data",
                  })
                const committed: Payload = {
                  ...event,
                  durable: { aggregateID: aggregate, seq, version: durable.version },
                }
                for (const projector of input.projectors.get(event.type) ?? []) {
                  yield* projector(committed)
                }
                if (options?.commit) yield* options.commit(seq)
                sequences.set(aggregate, seq)
                rows.push({
                  id: event.id,
                  aggregate_id: aggregate,
                  seq,
                  type: Event.versionedType(event.type, durable.version),
                  data: encoded,
                })
                pending.push(committed)
              }
              for (const [aggregate, seq] of sequences) {
                yield* input.db
                  .insert(EventSequenceTable)
                  .values({ aggregate_id: aggregate, seq })
                  .onConflictDoUpdate({ target: EventSequenceTable.aggregate_id, set: { seq } })
                  .run()
                  .pipe(Effect.orDie)
              }
              for (let offset = 0; offset < rows.length; offset += 100) {
                yield* input.db
                  .insert(EventTable)
                  .values(rows.slice(offset, offset + 100))
                  .run()
                  .pipe(Effect.orDie)
              }
            }),
          { behavior: "immediate" },
        )
        .pipe(
          Effect.orDie,
          Effect.tap(() =>
            Effect.forEach(
              pending,
              (event) =>
                Effect.forEach(
                  event.durable ? (input.durable.get(event.durable.aggregateID) ?? []) : [],
                  (wake) => PubSub.publish(wake, undefined),
                  { discard: true },
                ),
              { discard: true },
            ),
          ),
          Effect.uninterruptible,
        )
      for (const event of pending) {
        yield* input.notify(event, event.durable !== undefined)
      }
    })
}
