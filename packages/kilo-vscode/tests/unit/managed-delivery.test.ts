import { describe, expect, test } from "bun:test"
import { ManagedSessionInbox, promptWhenSafe } from "../../src/agent-manager/managed-delivery"

describe("managed session delivery", () => {
  test("sends immediately when status is missing (idle default)", async () => {
    const promptAsync = async () => ({})
    const client = { session: { promptAsync } }
    const sent: string[] = []
    const wrapped = {
      session: {
        promptAsync: async (input: { parts: Array<{ text: string }> }) => {
          sent.push(input.parts[0]?.text ?? "")
          return promptAsync()
        },
      },
    }
    const result = await promptWhenSafe(wrapped, {
      sessionId: "s1",
      directory: "/repo",
      text: "hello",
    })
    expect(result).toBe("sent")
    expect(sent).toEqual(["hello"])
  })

  test("queues while busy and flushes the same text later", async () => {
    const inbox = new ManagedSessionInbox()
    inbox.enqueuePrompt({ sessionId: "s1", directory: "/repo", text: "later" })
    expect(inbox.takeForSession("s1")).toEqual([{ sessionId: "s1", directory: "/repo", text: "later" }])
    expect(inbox.takeForSession("s1")).toEqual([])
  })

  test("queues promptWhenSafe when the session is busy", async () => {
    const client = {
      session: {
        status: async () => ({ data: { s1: { type: "busy" as const } } }),
        promptAsync: async () => {
          throw new Error("must not send while busy")
        },
      },
    }
    const { managedInbox } = await import("../../src/agent-manager/managed-delivery")
    const before = managedInbox.events.length
    const result = await promptWhenSafe(client, { sessionId: "s1", directory: "/repo", text: "hold" })
    expect(result).toBe("queued")
    expect(managedInbox.events.length).toBeGreaterThan(before)
  })
})
