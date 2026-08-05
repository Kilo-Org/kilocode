import { expect } from "bun:test"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "../lib/effect"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionMessage } from "@opencode-ai/core/session/message"
import * as StoredMessage from "@opencode-ai/core/kilocode/session-message"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"

const database = Database.layerFromPath(":memory:")
const it = testEffect(AppNodeBuilder.build(LayerNode.group([EventV2.node, Database.node]), [[Database.node, database]]))
const replay = testEffect(
  AppNodeBuilder.build(LayerNode.group([EventV2.node, Database.node, SessionProjector.node]), [
    [Database.node, database],
  ]),
)

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

    const stored = yield* events.durable({ aggregateID: sessionID }).pipe(Stream.take(1), Stream.runHead)
    expect(stored._tag).toBe("Some")
    if (stored._tag === "None") return
    expect(stored.value.data).toMatchObject({
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

replay.effect("reads and replays released prompt promotion events", () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    const sessionID = SessionV2.ID.make("ses_prompt_promoted_compat")
    const messageID = SessionMessage.ID.make("msg_prompt_promoted_compat")
    const prompt = Prompt.make({ text: "Promoted from a released session" })

    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "compat",
        directory: "/project",
        title: "compat",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)

    yield* events.replayAll(
      [
        {
          id: EventV2.ID.make("evt_prompt_admitted_compat"),
          type: "session.next.prompt.admitted.1",
          aggregateID: sessionID,
          seq: 0,
          data: { timestamp: 1, sessionID, messageID, prompt, delivery: "queue" },
        },
        {
          id: EventV2.ID.make("evt_prompt_promoted_compat"),
          type: "session.next.prompt.promoted.1",
          aggregateID: sessionID,
          seq: 1,
          data: { timestamp: 2, sessionID, messageID, prompt, timeCreated: 1 },
        },
      ],
      { publish: true },
    )

    const history = yield* EventV2.readAggregate(db, {
      aggregateID: sessionID,
      limit: 10,
      manifest: SessionDurable,
    })
    expect(history.events.map((event) => event.type)).toEqual([
      "session.next.prompt.admitted",
      "session.next.prompt.promoted",
    ])
    expect(yield* events.durable({ aggregateID: sessionID }).pipe(Stream.take(2), Stream.runCollect)).toHaveLength(2)
    expect(yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, messageID)).get()).toMatchObject({
      delivery: "queue",
      promoted_seq: 1,
    })
    expect(
      yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get(),
    ).toMatchObject({
      id: messageID,
      type: "user",
      seq: 1,
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
