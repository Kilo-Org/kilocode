// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { SessionMessageUpdater } from "@opencode-ai/core/session-message-updater"

describe("v2 shell event correlation", () => {
  test("an unmatched end is ignored before a matching start and end complete one record", () => {
    const state: SessionMessageUpdater.MemoryState = { messages: [] }
    const sessionID = SessionID.make("session")
    const callID = "call"
    const updater = SessionMessageUpdater.memory(state)

    SessionMessageUpdater.update(updater, {
      id: EventV2.ID.create(),
      type: "session.next.shell.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(0),
        callID: "missing",
        output: "ignored",
      },
    } satisfies SessionEvent.Event)
    expect(state.messages).toEqual([])

    SessionMessageUpdater.update(updater, {
      id: EventV2.ID.create(),
      type: "session.next.shell.started",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        callID,
        command: "pwd",
      },
    } satisfies SessionEvent.Event)

    SessionMessageUpdater.update(updater, {
      id: EventV2.ID.create(),
      type: "session.next.shell.ended",
      data: {
        sessionID,
        timestamp: DateTime.makeUnsafe(2),
        callID,
        output: "/tmp",
      },
    } satisfies SessionEvent.Event)

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({
      type: "shell",
      callID,
      command: "pwd",
      output: "/tmp",
      time: {
        created: DateTime.makeUnsafe(1),
        completed: DateTime.makeUnsafe(2),
      },
    })
  })
})
