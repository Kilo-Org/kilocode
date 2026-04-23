import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { abortSession, parseQueued } from "../../src/kilo-provider/abort"

function client(calls: unknown[], fail = false) {
  return {
    session: {
      abort: async (params: unknown, opts: unknown) => {
        calls.push({ type: "abort", params, opts })
        if (fail) throw new Error("abort failed")
        return { data: true }
      },
      deleteMessage: async (params: unknown, opts: unknown) => {
        calls.push({ type: "delete", params, opts })
        return { data: true }
      },
    },
  } as unknown as KiloClient
}

describe("parseQueued", () => {
  it("keeps only string queued message ids", () => {
    expect(parseQueued(["message_1", 2, null, "message_2", {}])).toEqual(["message_1", "message_2"])
  })

  it("returns empty ids for invalid payloads", () => {
    expect(parseQueued(undefined)).toEqual([])
    expect(parseQueued({ queuedMessageIDs: ["message_1"] })).toEqual([])
  })
})

describe("abortSession", () => {
  it("aborts before removing queued follow-up messages", async () => {
    const calls: unknown[] = []

    await abortSession({
      client: client(calls),
      sessionID: "session_1",
      dir: "/repo",
      queuedMessageIDs: ["message_2", "message_3", "message_2"],
    })

    expect(calls).toEqual([
      {
        type: "abort",
        params: { sessionID: "session_1", directory: "/repo" },
        opts: { throwOnError: true },
      },
      {
        type: "delete",
        params: { sessionID: "session_1", messageID: "message_2", directory: "/repo" },
        opts: { throwOnError: true },
      },
      {
        type: "delete",
        params: { sessionID: "session_1", messageID: "message_3", directory: "/repo" },
        opts: { throwOnError: true },
      },
    ])
  })

  it("does not remove queued messages when abort fails", async () => {
    const calls: unknown[] = []

    await expect(
      abortSession({
        client: client(calls, true),
        sessionID: "session_1",
        dir: "/repo",
        queuedMessageIDs: ["message_2"],
      }),
    ).rejects.toThrow("abort failed")

    expect(calls).toEqual([
      {
        type: "abort",
        params: { sessionID: "session_1", directory: "/repo" },
        opts: { throwOnError: true },
      },
    ])
  })
})
