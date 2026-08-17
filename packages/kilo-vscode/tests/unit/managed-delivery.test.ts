import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  flushIdleSession,
  managedInbox,
  promptWhenSafe,
  queueBusyAgentSend,
  resumeQueuedSessions,
} from "../../src/agent-manager/managed-delivery"

describe("managed session delivery", () => {
  afterEach(() => {
    managedInbox.events.length = 0
    managedInbox.detachPersistence()
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

  test("queueBusyAgentSend holds a follow-up text send until flushIdleSession", async () => {
    expect(
      queueBusyAgentSend({
        busy: true,
        sessionId: "s1",
        directory: "/repo",
        text: "next",
      }),
    ).toBe("queued")
    expect(
      queueBusyAgentSend({
        busy: false,
        sessionId: "s1",
        directory: "/repo",
        text: "skip",
      }),
    ).toBe("pass")
    expect(
      queueBusyAgentSend({
        busy: true,
        sessionId: "s1",
        directory: "/repo",
        text: "attachment",
        fileCount: 1,
      }),
    ).toBe("pass")

    const sent: string[] = []
    const idle = {
      session: {
        promptAsync: async (input: { parts: Array<{ text: string }> }) => {
          sent.push(input.parts[0]?.text ?? "")
        },
      },
    }
    expect(await flushIdleSession(idle, "s1")).toBe(1)
    expect(sent).toEqual(["next"])
  })

  test("persists queued prompts and resumes them when idle", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "managed-inbox-"))
    managedInbox.attachPersistence(root)
    expect(await promptWhenSafe(
      {
        session: {
          status: async () => ({ data: { s1: { type: "busy" as const } } }),
          promptAsync: async () => {
            throw new Error("must not send while busy")
          },
        },
      },
      { sessionId: "s1", directory: "/repo", text: "later" },
    )).toBe("queued")

    managedInbox.events.length = 0
    const sent: string[] = []
    const idle = {
      session: {
        status: async () => ({ data: { s1: { type: "idle" as const } } }),
        promptAsync: async (input: { parts: Array<{ text: string }> }) => {
          sent.push(input.parts[0]?.text ?? "")
        },
      },
    }
    expect(await resumeQueuedSessions(idle)).toBe(1)
    expect(sent).toEqual(["later"])
    expect(managedInbox.telemetry.resumes).toBeGreaterThan(0)
  })
})
