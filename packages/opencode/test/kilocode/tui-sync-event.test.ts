/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import { normalizeSyncEvent } from "../../src/cli/cmd/tui/context/event"
import { mount, wait } from "../cli/cmd/tui/sync-fixture"

describe("TUI sync event wire format", () => {
  test("normalizes the runtime sync envelope", () => {
    const event = normalizeSyncEvent({
      type: "sync",
      syncEvent: {
        type: "message.part.updated.1",
        id: "evt_1",
        seq: 3,
        aggregateID: "ses_1",
        data: {
          sessionID: "ses_1",
          part: {
            id: "prt_1",
            sessionID: "ses_1",
            messageID: "msg_1",
            type: "text",
            text: "response",
          },
          time: 1,
        },
      },
    })

    expect(event?.type).toBe("sync")
    expect(event?.name).toBe("message.part.updated.1")
    expect(event?.id).toBe("evt_1")
    expect(event?.seq).toBe(3)
    expect(String(event?.aggregateID)).toBe("ses_1")
    if (event?.name !== "message.part.updated.1") throw new Error("Expected message part update")
    expect(event.data.part).toMatchObject({
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text",
      text: "response",
    })
  })

  test("preserves generated SDK sync payloads", () => {
    const payload = {
      type: "sync",
      name: "message.removed.1",
      id: "evt_2",
      seq: 4,
      aggregateID: "sessionID",
      data: { sessionID: "ses_1", messageID: "msg_1" },
    } as const

    expect(normalizeSyncEvent(payload)).toBe(payload)
  })

  test("ignores non-sync events", () => {
    expect(normalizeSyncEvent({ type: "session.status" })).toBeUndefined()
  })

  test("applies runtime sync envelopes to the TUI message store", async () => {
    const { app, emit, sync } = await mount()
    const sessionID = "ses_wire"
    const messageID = "msg_wire"

    try {
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "sync",
          syncEvent: {
            type: "message.updated.1",
            id: "evt_message",
            seq: 0,
            aggregateID: sessionID,
            data: {
              sessionID,
              info: {
                id: messageID,
                sessionID,
                role: "assistant",
                parentID: "msg_parent",
                mode: "code",
                agent: "code",
                path: { cwd: "/tmp/opencode", root: "/tmp/opencode" },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                modelID: "kilo-auto/free",
                providerID: "kilo",
                time: { created: 1 },
              },
            },
          },
        },
      } as unknown as GlobalEvent)
      emit({
        directory: "/tmp/opencode/packages/opencode",
        project: "proj_test",
        payload: {
          type: "sync",
          syncEvent: {
            type: "message.part.updated.1",
            id: "evt_part",
            seq: 1,
            aggregateID: sessionID,
            data: {
              sessionID,
              part: {
                id: "prt_wire",
                sessionID,
                messageID,
                type: "text",
                text: "rendered response",
              },
              time: 2,
            },
          },
        },
      } as unknown as GlobalEvent)

      await wait(() => sync.data.part[messageID]?.[0]?.type === "text")
      expect(sync.data.message[sessionID]?.[0]?.id).toBe(messageID)
      expect(sync.data.part[messageID]?.[0]).toMatchObject({ type: "text", text: "rendered response" })
    } finally {
      app.renderer.destroy()
    }
  })
})
