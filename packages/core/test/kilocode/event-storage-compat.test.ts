import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "../lib/effect"

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
