import { expect } from "bun:test"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "../lib/effect"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionMessage } from "@opencode-ai/core/session/message"
import * as StoredMessage from "@opencode-ai/core/kilocode/session-message"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const it = testEffect(Layer.mergeAll(events, database))

it.effect("decodes legacy durable tool content without exposing it to consumers", () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sessionID = SessionV2.ID.make("ses_storage_compat")

    yield* events.replay({
      id: EventV2.ID.create(),
      type: EventV2.versionedType(SessionEvent.Tool.Success.type, 1),
      aggregateID: sessionID,
      seq: 0,
      data: {
        timestamp: 1,
        sessionID,
        assistantMessageID: "msg_assistant",
        callID: "call_read",
        structured: {},
        content: [{ type: "media", mediaType: "image/png", data: "AAAA", filename: "image.png" }],
        provider: { executed: true },
      },
    })

    const stored = yield* events.aggregateEvents({ aggregateID: sessionID }).pipe(Stream.take(1), Stream.runHead)
    expect(stored._tag).toBe("Some")
    if (stored._tag === "None") return
    expect(stored.value.event.data).toMatchObject({
      content: [
        {
          type: "file",
          uri: "data:image/png;base64,AAAA",
          mime: "image/png",
          name: "image.png",
        },
      ],
    })
  }),
)

it.effect("writes released durable tool and compaction shapes", () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const sessionID = SessionV2.ID.make("ses_current_writer_compat")
    yield* events.publish(SessionEvent.Tool.Success, {
      timestamp: DateTime.makeUnsafe(1),
      sessionID,
      assistantMessageID: SessionMessage.ID.make("msg_assistant"),
      callID: "call_read",
      structured: {},
      content: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "image.png" }],
      provider: { executed: true },
    })
    yield* events.publish(SessionEvent.Compaction.Ended, {
      timestamp: DateTime.makeUnsafe(2),
      sessionID,
      messageID: SessionMessage.ID.make("msg_compaction"),
      reason: "auto",
      text: "summary",
      recent: "recent",
      include: "recent",
    })

    const rows = yield* db.select().from(EventTable).all().pipe(Effect.orDie)
    expect(rows[0]).toMatchObject({
      type: EventV2.versionedType(SessionEvent.Tool.Success.type, 1),
      data: {
        content: [
          {
            type: "file",
            source: { type: "data", data: "AAAA" },
            mime: "image/png",
            name: "image.png",
          },
        ],
      },
    })
    expect(rows[1]).toMatchObject({
      type: EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1),
      data: { text: "summary", include: "recent" },
    })
  }),
)

it.effect("stores self-contained compaction projections for released readers", () =>
  Effect.sync(() => {
    const encoded = StoredMessage.encode({
      id: "msg_compaction",
      type: "compaction",
      reason: "auto",
      summary: "summary",
      recent: "recent",
      time: { created: 1 },
    })
    const released = Schema.decodeUnknownSync(
      Schema.Struct({ type: Schema.Literal("compaction"), summary: Schema.String }),
    )(encoded)
    expect(released.summary).toBe("summary\n\nRecent context:\nrecent")
    expect(StoredMessage.normalize(encoded)).toMatchObject({ summary: "summary", recent: "recent" })
  }),
)
