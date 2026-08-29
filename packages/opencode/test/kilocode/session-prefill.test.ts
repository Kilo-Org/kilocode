import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { KiloPrefill } from "@/kilocode/session/prefill"

function user(content = "hello"): ModelMessage {
  return { role: "user", content }
}

function assistant(content: string | Array<Record<string, unknown>>): ModelMessage {
  return { role: "assistant", content } as unknown as ModelMessage
}

const scaffold: ModelMessage = assistant([{ type: "step-start" }])

describe("KiloPrefill.ensureUserTail", () => {
  test("leaves a user-terminated array unchanged", () => {
    const messages = [user("what is 2+2?"), assistant("4"), user("thanks")] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toBe(messages)
  })

  test("leaves a tool-terminated array unchanged", () => {
    const messages = [
      user("run it"),
      assistant([{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "pwd" } }]),
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call-1", toolName: "bash", output: { type: "text", value: "done" } }],
      },
    ] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toBe(messages)
  })

  test("appends a continuation when the array ends with a content-bearing assistant", () => {
    const messages = [user("explain X"), assistant("X is ...")] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.slice(0, -1)).toEqual(messages)
    const tail = out.at(-1)
    expect(tail?.role).toBe("user")
    expect(tail && typeof tail.content === "string" ? tail.content : "").toContain("Continue")
  })

  test("drops a trailing scaffold-only assistant", () => {
    const messages = [user("hi"), scaffold] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toEqual([user("hi")])
  })

  test("drops a run of trailing scaffold-only assistants and keeps the content tail well-formed", () => {
    const messages = [user("hi"), assistant("done"), scaffold, scaffold] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.slice(0, 2)).toEqual([user("hi"), assistant("done")])
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with reasoning text and appends a continuation", () => {
    const messages = [user("hi"), assistant([{ type: "reasoning", text: "thinking..." }])] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with a tool call and appends a continuation", () => {
    const messages = [
      user("hi"),
      assistant([{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "pwd" } }]),
    ] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("drops an empty-text assistant as scaffold", () => {
    const messages = [user("hi"), assistant([{ type: "text", text: "" }])] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toEqual([user("hi")])
  })

  test("drops a whitespace-text assistant as scaffold", () => {
    const messages = [user("hi"), assistant([{ type: "text", text: "  " }])] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toEqual([user("hi")])
  })

  test("formats an empty array with a continuation user message", () => {
    const out = KiloPrefill.ensureUserTail([])
    expect(out).toHaveLength(1)
    expect(out[0]?.role).toBe("user")
  })

  test("formats a scaffold-only array with a continuation user message", () => {
    const out = KiloPrefill.ensureUserTail([scaffold])
    expect(out).toHaveLength(1)
    expect(out[0]?.role).toBe("user")
  })
})
