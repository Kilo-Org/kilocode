import { describe, expect, it } from "bun:test"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { sessionChildren } from "../webview-ui/src/v2/session-children"

function tool(name: string, child?: string, status: "completed" | "running" | "streaming" = "completed") {
  return {
    type: "tool",
    id: `tool-${child ?? name}`,
    name,
    state:
      status === "streaming"
        ? { status, input: "" }
        : { status, input: {}, metadata: child ? { sessionID: child } : {}, content: [] },
    time: { created: 1 },
  } as unknown as SessionMessageAssistantTool
}

function assistant(content: SessionMessageAssistantTool[]): SessionMessageInfo {
  return {
    type: "assistant",
    id: "assistant",
    agent: "code",
    model: { providerID: "test", id: "test" },
    content,
    time: { created: 1 },
  } as unknown as SessionMessageInfo
}

describe("sessionChildren", () => {
  it("returns the child session ids in call order and dedupes them", () => {
    expect(
      sessionChildren([assistant([tool("subagent", "ses-b"), tool("subagent", "ses-a"), tool("subagent", "ses-b")])]),
    ).toEqual(["ses-b", "ses-a"])
  })

  it("ignores non-subagent tools, streaming parts, and parts without a child id", () => {
    expect(
      sessionChildren([
        assistant([
          tool("read"),
          tool("subagent", "ses-streaming", "streaming"),
          tool("subagent"),
          tool("subagent", "ses-completed"),
        ]),
      ]),
    ).toEqual(["ses-completed"])
  })

  it("includes a child id while its subagent call is still running", () => {
    expect(sessionChildren([assistant([tool("subagent", "ses-running", "running")])])).toEqual(["ses-running"])
  })

  it("stays empty without subagent parts", () => {
    expect(sessionChildren([assistant([tool("read")])])).toEqual([])
  })
})
