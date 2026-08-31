import { describe, expect, test } from "bun:test"
import { z } from "zod/v4"
import type { ModelMessage } from "ai"
import { KiloMessageDiagnostics } from "@/kilocode/session/message-diagnostics"
import { LLMAISDK } from "@/session/llm/ai-sdk"
import { Effect, Exit } from "effect"

const messages: ModelMessage[] = [
  {
    role: "user",
    content: "summarize the repo",
  },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "on it" },
      { type: "tool-call", toolCallId: "call-1", toolName: "grep", input: { pattern: "x" } },
    ],
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "call-1", toolName: "grep", output: { type: "text", value: "hit" } }],
  },
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-2", toolName: "write", input: { path: "a.ts" } }],
  },
]

describe("messageShape", () => {
  test("summarizes roles and part sequences without content", () => {
    const shape = KiloMessageDiagnostics.messageShape(messages)
    expect(shape).toEqual([
      { index: 0, role: "user", contentKind: "string", parts: [], providerOptions: undefined },
      {
        index: 1,
        role: "assistant",
        contentKind: "array",
        parts: [
          { type: "reasoning" },
          { type: "text" },
          { type: "tool-call", toolCallId: "call-1", toolName: "grep" },
        ],
        providerOptions: undefined,
      },
      {
        index: 2,
        role: "tool",
        contentKind: "array",
        parts: [{ type: "tool-result", toolCallId: "call-1", toolName: "grep" }],
        providerOptions: undefined,
      },
      {
        index: 3,
        role: "assistant",
        contentKind: "array",
        parts: [{ type: "tool-call", toolCallId: "call-2", toolName: "write" }],
        providerOptions: undefined,
      },
    ])
  })

  test("lists provider option keys, not values", () => {
    const shape = KiloMessageDiagnostics.messageShape([
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        providerOptions: { cacheControl: { type: "ephemeral" } },
      },
    ])
    expect(shape[0]?.providerOptions).toEqual(["cacheControl"])
  })

  test("distinguishes absent content from string content", () => {
    const shape = KiloMessageDiagnostics.messageShape([
      { role: "user", content: "plain text" } as ModelMessage,
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
      { role: "user" } as ModelMessage,
    ])
    expect(shape.map((s) => s.contentKind)).toEqual(["string", "array", "absent"])
    expect(shape[0]?.parts).toEqual([])
    expect(shape[2]?.parts).toEqual([])
  })

  test("degrades malformed runtime parts instead of throwing", () => {
    // The messages failed schema validation, so parts may be null/primitives at
    // runtime. Diagnostics on the failure path must never throw.
    const malformed = {
      role: "assistant",
      content: [null, 42, "bare-string", { type: "tool-call" }, { type: "text" }],
    } as unknown as ModelMessage
    const shape = KiloMessageDiagnostics.messageShape([malformed])
    expect(shape[0]?.contentKind).toBe("array")
    expect(shape[0]?.parts).toEqual([
      { type: "null" },
      { type: "42" },
      { type: "bare-string" },
      { type: "tool-call", toolCallId: "undefined", toolName: "undefined" },
      { type: "text" },
    ])
  })
})

describe("toolPairing", () => {
  test("flags unmatched calls and orphan results", () => {
    const pairing = KiloMessageDiagnostics.toolPairing(messages)
    expect(pairing.totalToolCalls).toBe(2)
    expect(pairing.matchedResultIds).toEqual(["call-1"])
    expect(pairing.unmatchedCallIds).toEqual(["call-2"])
    expect(pairing.orphanResultIds).toEqual([])
  })

  test("flags orphan results without a matching call", () => {
    const pairing = KiloMessageDiagnostics.toolPairing([
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "ghost", toolName: "read", output: { type: "text", value: "x" } }],
      },
    ])
    expect(pairing.totalToolCalls).toBe(0)
    expect(pairing.orphanResultIds).toEqual(["ghost"])
  })

  test("skips malformed parts instead of throwing", () => {
    const pairing = KiloMessageDiagnostics.toolPairing([
      {
        role: "assistant",
        content: [null, "nope", { type: "tool-call", toolCallId: "ok" }],
      } as unknown as ModelMessage,
    ])
    expect(pairing.totalToolCalls).toBe(1)
    expect(pairing.unmatchedCallIds).toEqual(["ok"])
  })
})

describe("schemaIssues", () => {
  test("extracts issue paths from a ZodError cause chain", () => {
    const schema = z.object({
      role: z.literal("assistant"),
      content: z.array(
        z.object({
          type: z.literal("text"),
          text: z.string(),
        }),
      ),
    })
    const parsed = schema.safeParse({ role: "assistant", content: [{ type: "text", text: 42 }] })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    const error = new Error("Invalid prompt: The messages do not match the ModelMessage[] schema.")
    error.cause = parsed.error
    const issues = KiloMessageDiagnostics.schemaIssues(error)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]).toContain("content.0.text")
  })

  test("recurses into union-nested errors to keep deep paths", () => {
    // The AI SDK validates against a union of message shapes, so zod/v4 reports
    // `invalid_union` with member failures nested under `errors`. The deep path
    // must survive the recursion.
    const schema = z.union([
      z.object({ role: z.literal("user"), content: z.string() }),
      z.object({
        role: z.literal("assistant"),
        content: z.array(
          z.object({
            type: z.literal("text"),
            text: z.string(),
          }),
        ),
      }),
    ])
    const parsed = schema.safeParse({
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: 42 }],
    })
    expect(parsed.success).toBe(false)
    if (parsed.success) return

    const error = new Error("Invalid prompt: The messages do not match the ModelMessage[] schema.")
    error.cause = parsed.error
    const issues = KiloMessageDiagnostics.schemaIssues(error)
    expect(issues.some((issue) => issue.includes("content.0"))).toBe(true)
  })

  test("returns nothing for unrelated errors", () => {
    expect(KiloMessageDiagnostics.schemaIssues(new Error("boom"))).toEqual([])
    expect(KiloMessageDiagnostics.schemaIssues(undefined)).toEqual([])
  })
})

describe("reportModelMessageError", () => {
  test("silently ignores non-schema errors", () => {
    const out = KiloMessageDiagnostics.reportModelMessageError(new Error("rate limited"), messages)
    expect(out).toBeUndefined()
  })

  test("returns the diagnostic for the ModelMessage[] schema mismatch", () => {
    const error = new Error("Invalid prompt: The messages do not match the ModelMessage[] schema.")
    const out = KiloMessageDiagnostics.reportModelMessageError(error, messages)
    expect(out).toBeDefined()
    expect(out?.messages.length).toBe(4)
  })
})

describe("LLMAISDK.toLLMEvents error-part mechanism", () => {
  test("converts an error part into the stream failure tapError observes", async () => {
    const state = LLMAISDK.adapterState()
    const error = new Error("Invalid prompt: The messages do not match the ModelMessage[] schema.")
    const effect = LLMAISDK.toLLMEvents(state, { type: "error", error })
    const exit = await Effect.runPromise(Effect.exit(effect))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("describe", () => {
  test("composes issues, shapes and pairing", () => {
    const error = new Error("Invalid prompt: The messages do not match the ModelMessage[] schema.")
    const out = KiloMessageDiagnostics.describe(error, messages)
    expect(out.issues).toEqual([])
    expect(out.messages.length).toBe(4)
    expect(out.pairing.unmatchedCallIds).toEqual(["call-2"])
  })
})
