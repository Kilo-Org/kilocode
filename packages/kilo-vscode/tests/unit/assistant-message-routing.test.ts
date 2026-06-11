import { describe, expect, it } from "bun:test"
import type { Part, ToolPart } from "@kilocode/sdk/v2"
import {
  UPSTREAM_SUPPRESSED_TOOLS,
  isKiloToolRenderable,
  matchToolRequest,
} from "../../webview-ui/src/components/chat/assistant-message-routing"

const base = { id: "prt_test", sessionID: "ses_test", messageID: "msg_test" }
const tool = (name: string, status: ToolPart["state"]["status"] = "completed"): ToolPart => ({
  ...base,
  type: "tool",
  tool: name,
  callID: `call_${name}`,
  state:
    status === "completed"
      ? { status, input: {}, output: "done", title: name, metadata: {}, time: { start: 1, end: 2 } }
      : status === "running"
        ? { status, input: {}, title: name, metadata: {}, time: { start: 1 } }
        : { status: "pending", input: {}, raw: "" },
})

describe("AssistantMessage Kilo tool routing", () => {
  it("continues to suppress running todo tools and render completed todo tools", () => {
    expect(UPSTREAM_SUPPRESSED_TOOLS.has("todowrite")).toBe(true)
    expect(UPSTREAM_SUPPRESSED_TOOLS.has("todoread")).toBe(true)
    expect(isKiloToolRenderable(tool("todowrite", "running"))).toBe(false)
    expect(isKiloToolRenderable(tool("todowrite", "completed"))).toBe(true)
    expect(isKiloToolRenderable(tool("todoread", "completed"))).toBe(true)
  })

  it("always keeps Question tool parts renderable after answer or dismissal", () => {
    expect(isKiloToolRenderable(tool("question", "pending"))).toBe(true)
    expect(isKiloToolRenderable(tool("question", "running"))).toBe(true)
    expect(isKiloToolRenderable(tool("question", "completed"))).toBe(true)
  })

  it("matches an active Question only by tool call and message", () => {
    const part = tool("question")
    const match = { id: "que_match", tool: { callID: part.callID, messageID: part.messageID } }
    const wrongCall = { id: "que_call", tool: { callID: "other", messageID: part.messageID } }
    const wrongMessage = { id: "que_message", tool: { callID: part.callID, messageID: "msg_other" } }

    expect(matchToolRequest(part, "question", [wrongCall, wrongMessage, match])).toBe(match)
    expect(matchToolRequest(part, "suggest", [match])).toBeUndefined()
    expect(matchToolRequest({ ...base, type: "text", text: "question" } as Part, "question", [match])).toBeUndefined()
  })
})
