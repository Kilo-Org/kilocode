import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { childTools } from "../webview-ui/src/v2/child-session"

const toolPart = (id: string) =>
  ({ type: "tool", id, name: "read", state: { status: "completed", input: {}, content: [] } }) as const

const assistant = (id: string, content: unknown[]) =>
  ({ id, type: "assistant", content }) as unknown as SessionMessageInfo

const user = { id: "user-1", type: "user", text: "hello" } as unknown as SessionMessageInfo

describe("childTools", () => {
  test("returns only tool parts from assistant messages, in order", () => {
    const messages = [
      user,
      assistant("a-1", [{ type: "reasoning", text: "thinking" }, toolPart("t-1")]),
      assistant("a-2", [toolPart("t-2")]),
    ]
    expect(childTools(messages).map((part) => part.id)).toEqual(["t-1", "t-2"])
  })

  test("returns an empty list for an unloaded child session", () => {
    expect(childTools([])).toEqual([])
  })
})
