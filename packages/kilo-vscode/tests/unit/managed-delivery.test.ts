import { afterEach, describe, expect, test } from "bun:test"
import { flushIdleSession, managedInbox, promptWhenSafe } from "../../src/agent-manager/managed-delivery"

describe("managed session delivery", () => {
  afterEach(() => {
    managedInbox.events.length = 0
  })

  test("sends immediately when status is missing (idle default)", async () => {
    const sent: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { parts: Array<{ text: string }> }) => {
          sent.push(input.parts[0]?.text ?? "")
        },
      },
    }
    const result = await promptWhenSafe(client, {
      sessionId: "s1",
      directory: "/repo",
      text: "hello",
    })
    expect(result).toBe("sent")
    expect(sent).toEqual(["hello"])
  })

  test("queues promptWhenSafe while busy then flushIdleSession sends the same text", async () => {
    const sent: string[] = []
    const busy = {
      session: {
        status: async () => ({ data: { s1: { type: "busy" as const } } }),
        promptAsync: async () => {
          throw new Error("must not send while busy")
        },
      },
    }
    expect(await promptWhenSafe(busy, { sessionId: "s1", directory: "/repo", text: "hold" })).toBe("queued")

    const idle = {
      session: {
        status: async () => ({ data: { s1: { type: "idle" as const } } }),
        promptAsync: async (input: { parts: Array<{ text: string }> }) => {
          sent.push(input.parts[0]?.text ?? "")
        },
      },
    }
    expect(await flushIdleSession(idle, "s1")).toBe(1)
    expect(sent).toEqual(["hold"])
    expect(await flushIdleSession(idle, "s1")).toBe(0)
  })
})
