import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { KiloPrefill } from "@/kilocode/session/prefill"

function user(content = "hello"): ModelMessage {
  return { role: "user", content }
}

function assistant(content: string | Array<Record<string, unknown>>): ModelMessage {
  return { role: "assistant", content } as unknown as ModelMessage
}

function tool(): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call-1", toolName: "bash", output: { type: "text", value: "done" } }],
  }
}

const scaffold: ModelMessage = assistant([{ type: "step-start" }])
const toolCall = () => assistant([{ type: "tool-call", toolCallId: "call-1", toolName: "bash", input: { cmd: "pwd" } }])

describe("KiloPrefill.ensureUserTail", () => {
  test("leaves a user-terminated array unchanged", () => {
    const messages = [user("what is 2+2?"), assistant("4"), user("thanks")] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toBe(messages)
  })

  test("leaves a tool-terminated array unchanged", () => {
    const messages = [user("run it"), toolCall(), tool()] satisfies ModelMessage[]

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

  test("keeps a tool-terminated array after dropping a trailing scaffold", () => {
    const messages = [user("run it"), toolCall(), tool(), scaffold] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out).toEqual([user("run it"), toolCall(), tool()])
  })

  test("keeps an assistant with reasoning text and appends a continuation", () => {
    const messages = [user("hi"), assistant([{ type: "reasoning", text: "thinking..." }])] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with an empty-text anthropic reasoning signature and appends a continuation", () => {
    const messages = [
      user("hi"),
      assistant([
        { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "sig-1" } } },
      ]),
    ] as ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with anthropic redacted data and appends a continuation", () => {
    const messages = [
      user("hi"),
      assistant([
        { type: "reasoning", text: "", providerOptions: { anthropic: { redactedData: ["abc"] } } },
      ]),
    ] as ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with a bedrock reasoning signature and appends a continuation", () => {
    const messages = [
      user("hi"),
      assistant([
        { type: "reasoning", text: "", providerOptions: { bedrock: { signature: "sig-b" } } },
      ]),
    ] as ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with a tool call and appends a continuation", () => {
    const messages = [user("hi"), toolCall()] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps an assistant with a file part and appends a continuation", () => {
    const messages = [user("hi"), assistant([{ type: "file", data: "x", mediaType: "image/png" }])] as ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.at(-2)).toBe(messages.at(-1))
    expect(out.at(-1)?.role).toBe("user")
  })

  test("keeps consecutive content-bearing assistants and appends one continuation", () => {
    const messages = [user("hi"), assistant("first"), assistant("second")] satisfies ModelMessage[]

    const out = KiloPrefill.ensureUserTail(messages)
    expect(out.slice(0, 3)).toEqual(messages)
    expect(out).toHaveLength(4)
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

  test("drops an empty-string assistant as scaffold", () => {
    const messages = [user("hi"), assistant("")] satisfies ModelMessage[]

    expect(KiloPrefill.ensureUserTail(messages)).toEqual([user("hi")])
  })

  test("drops an empty-array-content assistant as scaffold", () => {
    const messages = [user("hi"), assistant([])] satisfies ModelMessage[]

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
