// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@kilocode/sdk/v2"
import { formatCount, getUsage } from "../../../src/cli/cmd/tui/routes/session/usage"

function assistant(id: string, input: number, output: number, read: number): AssistantMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: 1 },
    parentID: "msg_parent",
    modelID: "claude-sonnet",
    providerID: "anthropic",
    mode: "code",
    agent: "code",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input,
      output,
      reasoning: 99,
      cache: {
        read,
        write: 7,
      },
    },
  }
}

function user(): UserMessage {
  return {
    id: "msg_user",
    sessionID: "ses_1",
    role: "user",
    time: { created: 0 },
    agent: "code",
    model: {
      providerID: "anthropic",
      modelID: "claude-sonnet",
    },
  }
}

describe("session usage", () => {
  test("sums input, output, and cache read across assistant messages only", () => {
    const msg: Message[] = [user(), assistant("a", 1200, 45, 300), assistant("b", 800, 55, 700)]

    expect(getUsage(msg)).toEqual({
      input: 2000,
      output: 100,
      cached: 1000,
    })
  })

  test("formats full counts with thousands separators", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(12345)).toBe("12,345")
    expect(formatCount(9876543)).toBe("9,876,543")
  })
})
