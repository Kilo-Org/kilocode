import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { handleQuestionReject, handleQuestionReply } from "../../src/kilo-provider/handlers/question"

describe("question handlers", () => {
  it("routes replies using the question session when provided", async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = {
      question: {
        reply: async (input: Record<string, unknown>) => {
          calls.push(input)
          return true
        },
        reject: async () => true,
      },
    } as unknown as KiloClient

    const ok = await handleQuestionReply(
      {
        client,
        currentSessionId: "ses-root",
        postMessage() {},
        getWorkspaceDirectory(sessionId) {
          return sessionId ? `/repo/${sessionId}` : "/repo"
        },
      },
      "req-1",
      [["Start new session"]],
      "ses-worktree",
    )

    expect(ok).toBe(true)
    expect(calls).toEqual([
      {
        requestID: "req-1",
        answers: [["Start new session"]],
        directory: "/repo/ses-worktree",
      },
    ])
  })

  it("falls back to the current session when no question session is provided", async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = {
      question: {
        reply: async (input: Record<string, unknown>) => {
          calls.push(input)
          return true
        },
        reject: async () => true,
      },
    } as unknown as KiloClient

    const ok = await handleQuestionReply(
      {
        client,
        currentSessionId: "ses-root",
        postMessage() {},
        getWorkspaceDirectory(sessionId) {
          return sessionId ? `/repo/${sessionId}` : "/repo"
        },
      },
      "req-2",
      [["Continue here"]],
    )

    expect(ok).toBe(true)
    expect(calls[0]?.directory).toBe("/repo/ses-root")
  })

  it("routes rejects using the question session when provided", async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = {
      question: {
        reply: async () => true,
        reject: async (input: Record<string, unknown>) => {
          calls.push(input)
          return true
        },
      },
    } as unknown as KiloClient

    const ok = await handleQuestionReject(
      {
        client,
        currentSessionId: "ses-root",
        postMessage() {},
        getWorkspaceDirectory(sessionId) {
          return sessionId ? `/repo/${sessionId}` : "/repo"
        },
      },
      "req-3",
      "ses-worktree",
    )

    expect(ok).toBe(true)
    expect(calls).toEqual([
      {
        requestID: "req-3",
        directory: "/repo/ses-worktree",
      },
    ])
  })
})
