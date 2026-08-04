import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { SessionResume } from "../../src/kilocode/session-resume"

// ── UUID validation ───────────────────────────────────────────────────

describe("SessionResume.isUUID", () => {
  test("accepts valid UUID v4", () => {
    expect(SessionResume.isUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
  })

  test("rejects non-UUID string", () => {
    expect(SessionResume.isUUID("not-a-uuid")).toBe(false)
    expect(SessionResume.isUUID("")).toBe(false)
    expect(SessionResume.isUUID("g1234567-1234-1234-1234-1234567890ab")).toBe(false)
  })
})

describe("SessionResume.validateUUID", () => {
  test("does not throw for valid UUID", () => {
    expect(() => SessionResume.validateUUID("550e8400-e29b-41d4-a716-446655440000")).not.toThrow()
  })

  test("throws for invalid UUID", () => {
    expect(() => SessionResume.validateUUID("bad")).toThrow(SessionResume.ParseError)
  })
})

// ── Detection ────────────────────────────────────────────────────────

describe("SessionResume.detect", () => {
  test("detects Claude format from real top-level envelope", () => {
    const line = {
      type: "user",
      version: "2.42.0",
      isSidechain: false,
      message: { id: "msg_001", role: "user", content: [{ type: "text", text: "hello" }] },
    }
    expect(SessionResume.detect(line)).toBe("claude")
  })

  test("detects Claude format from assistant with tool_use", () => {
    const line = {
      type: "assistant",
      version: "2.42.0",
      isSidechain: false,
      message: {
        id: "msg_002",
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_01", name: "read", input: {} }],
      },
    }
    expect(SessionResume.detect(line)).toBe("claude")
  })

  test("detects Codex format from session_meta", () => {
    const line = { type: "session_meta", payload: { cli_version: "0.8.0", cwd: "/test" } }
    expect(SessionResume.detect(line)).toBe("codex")
  })

  test("detects Codex format from response_item", () => {
    const line = {
      type: "response_item",
      payload: {
        id: "item_001",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    }
    expect(SessionResume.detect(line)).toBe("codex")
  })

  test("returns undefined for non-message objects", () => {
    expect(SessionResume.detect(null)).toBeUndefined()
    expect(SessionResume.detect("string")).toBeUndefined()
    expect(SessionResume.detect({})).toBeUndefined()
    expect(SessionResume.detect([])).toBeUndefined()
  })
})

// ── Claude parsing ───────────────────────────────────────────────────

describe("Claude parseLines", () => {
  test("parses simple user+assistant text exchange with real envelopes", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"text","text":"Hi there!"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.format).toBe("claude")
    expect(result.version).toBe(2)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toEqual({
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    })
    expect(result.steps[1]).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "Hi there!" }],
    })
  })

  test("accepts string user content and ignores transcript metadata", () => {
    const text = [
      '{"type":"permission-mode","sessionId":"session"}',
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":"Hello"}}',
      '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
    ].join("\n")

    expect(SessionResume.parseLines(text).steps).toEqual([
      { role: "user", parts: [{ type: "text", text: "Hello" }] },
      { role: "assistant", parts: [{ type: "text", text: "Hi" }] },
    ])
  })

  test("keeps a real user turn beside paired tool results", () => {
    const text = [
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":[{"type":"text","text":"Start"}]}}',
      '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool","name":"read","input":{}}]}}',
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool","content":"done"},{"type":"text","text":"Continue"}]}}',
    ].join("\n")

    expect(SessionResume.parseLines(text).steps.map((step) => step.role)).toEqual(["user", "assistant", "user"])
    expect(SessionResume.parseLines(text).steps[2]?.parts).toEqual([{ type: "text", text: "Continue" }])
  })

  test("keeps a partially paired tool step before a mixed later user turn", () => {
    const text = [
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":"Start"}}',
      '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"tool_use","id":"first","name":"read","input":{}},{"type":"tool_use","id":"second","name":"edit","input":{}}]}}',
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"first","content":"done"},{"type":"text","text":"Also say hi"}]}}',
    ].join("\n")

    const steps = SessionResume.parseLines(text).steps
    expect(steps.map((step) => step.role)).toEqual(["user", "assistant", "user"])
    expect(steps[1]?.parts.map((part) => part.type)).toEqual(["tool_call", "tool_call", "tool_result", "error"])
    expect(steps[2]?.parts).toEqual([{ type: "text", text: "Also say hi" }])
  })

  test("normalizes object tool results", () => {
    const claude = [
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":[{"type":"text","text":"Start"}]}}',
      '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"tool_use","id":"tool","name":"read","input":{}}]}}',
      '{"type":"user","version":"2.42.0","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool","content":{"value":1}}]}}',
    ].join("\n")
    const claudeTool = SessionResume.parseLines(claude).steps[1]?.parts.find((part) => part.type === "tool_result")
    expect(claudeTool).toMatchObject({ content: '{"value":1}' })
  })

  test("reads version from real Claude envelope", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.version).toBe(2)
  })

  test("rejects unsupported Claude major version", () => {
    const text = [
      '{"type":"user","version":"3.0.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
    ].join("\n")

    expect(() => SessionResume.parseLines(text)).toThrow(SessionResume.ParseError)
  })

  test("rejects Claude records without version field", () => {
    const text = [
      '{"type":"user","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
    ].join("\n")

    expect(() => SessionResume.parseLines(text)).toThrow("missing version")
  })

  test("pairs tool_use with tool_result", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Read file"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"text","text":"Reading..."},{"type":"tool_use","id":"toolu_01","name":"read","input":{"file":"foo.ts"}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"file contents"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_004","role":"assistant","content":[{"type":"text","text":"Done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(3)

    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts).toEqual([{ type: "text", text: "Read file" }])

    expect(result.steps[1].role).toBe("assistant")
    const tc = result.steps[1].parts.find((p): p is SessionResume.ToolCall => p.type === "tool_call")
    const tr = result.steps[1].parts.find((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(tc).toBeDefined()
    expect(tc!.id).toBe("toolu_01")
    expect(tc!.name).toBe("read")
    expect(tr).toBeDefined()
    expect(tr!.callID).toBe("toolu_01")
    expect(tr!.content).toBe("file contents")

    expect(result.steps[2].role).toBe("assistant")
    expect(result.steps[2].parts).toEqual([{ type: "text", text: "Done." }])
  })

  test("pairs multiple tool calls with results in one round", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Do two things"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"tool_use","id":"call_a","name":"read","input":{}},{"type":"tool_use","id":"call_b","name":"edit","input":{}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"user","content":[{"type":"tool_result","tool_use_id":"call_a","content":"result A"},{"type":"tool_result","tool_use_id":"call_b","content":"result B"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_004","role":"assistant","content":[{"type":"text","text":"Both done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(3)

    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const calls = mid.parts.filter((p): p is SessionResume.ToolCall => p.type === "tool_call")
    const results = mid.parts.filter((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(calls).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect(calls.map((c) => c.id).sort()).toEqual(["call_a", "call_b"])
    expect(results.map((r) => r.callID).sort()).toEqual(["call_a", "call_b"])
  })

  test("merges consecutive assistant messages into one pending step", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Go"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"tool_use","id":"a","name":"read","input":{}}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"assistant","content":[{"type":"tool_use","id":"b","name":"edit","input":{}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_004","role":"user","content":[{"type":"tool_result","tool_use_id":"a","content":"ra"},{"type":"tool_result","tool_use_id":"b","content":"rb"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_005","role":"assistant","content":[{"type":"text","text":"Done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(3)

    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const calls = mid.parts.filter((p): p is SessionResume.ToolCall => p.type === "tool_call")
    const results = mid.parts.filter((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(calls).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect(calls.map((c) => c.id).sort()).toEqual(["a", "b"])
    expect(results.map((r) => r.callID).sort()).toEqual(["a", "b"])
  })

  test("excludes sidechain records from parsed history", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":true,"message":{"id":"side_001","role":"user","content":[{"type":"text","text":"Sidechain"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts).toEqual([{ type: "text", text: "Hello" }])
    expect(result.steps[1].role).toBe("assistant")
    expect(result.steps[1].parts).toEqual([{ type: "text", text: "Hi" }])
  })

  test("skips known metadata record types", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"ai-title","version":"2.42.0","isSidechain":true,"message":{"id":"title_001","role":"assistant","content":[{"type":"text","text":"Session title"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(2)
  })

  test("handles unpaired tool call in final step", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Run"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"tool_use","id":"orphan_1","name":"read","input":{}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"user","content":[{"type":"text","text":"New topic"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(3)

    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const errors = mid.parts.filter((p): p is SessionResume.ErrorPart => p.type === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("Unpaired tool call")
    expect(errors[0].message).toContain("orphan_1")
  })

  test("handles repeated tool_use IDs across different rounds", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Read twice"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"read","input":{"file":"a.ts"}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"content a"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_004","role":"assistant","content":[{"type":"text","text":"First read done."}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_005","role":"user","content":[{"type":"text","text":"Read again"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_006","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"read","input":{"file":"b.ts"}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_007","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"content b"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_008","role":"assistant","content":[{"type":"text","text":"Second read done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const toolSteps = result.steps.filter(
      (s) => s.role === "assistant" && s.parts.some((p) => p.type === "tool_call"),
    )
    expect(toolSteps).toHaveLength(2)

    for (const step of toolSteps) {
      const tr = step.parts.find((p): p is SessionResume.ToolResult => p.type === "tool_result")
      expect(tr).toBeDefined()
      expect(tr!.callID).toBe("toolu_01")
    }
  })

  test("parses reasoning/thinking blocks from real envelope", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Q"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"thinking","thinking":"Let me think...","signature":"sig_test"},{"type":"text","text":"Answer"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const assistant = result.steps[1]
    expect(assistant.role).toBe("assistant")
    expect(assistant.parts).toHaveLength(2)
    expect(assistant.parts[0]).toEqual({ type: "reasoning", text: "Let me think..." })
    expect(assistant.parts[1]).toEqual({ type: "text", text: "Answer" })
  })

  test("handles redacted_thinking as unsupported", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Test"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"redacted_thinking","data":"encrypted"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)

    const assistant = result.steps[1]
    const unsupportedParts = assistant.parts.filter(
      (p): p is SessionResume.Unsupported => p.type === "unsupported",
    )
    expect(unsupportedParts).toHaveLength(1)
    expect(unsupportedParts[0].reason).toBe("encrypted reasoning block")
  })

  test("handles unknown content types as unsupported", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Test"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"custom_block","data":"unknown"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)

    const assistant = result.steps[1]
    const unsupportedParts = assistant.parts.filter(
      (p): p is SessionResume.Unsupported => p.type === "unsupported",
    )
    expect(unsupportedParts).toHaveLength(1)
    expect(unsupportedParts[0].reason).toContain("unknown content type")
    expect(unsupportedParts[0].reason).toContain("custom_block")
  })

  test("counts server_tool_result as unsupported in tool-result message", () => {
    const text = [
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Go"}]}}',
      '{"type":"assistant","version":"2.42.0","isSidechain":false,"message":{"id":"msg_002","role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"read","input":{}}]}}',
      '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_003","role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01","content":"ok"},{"type":"server_tool_result","tool_use_id":"toolu_99","content":"raw"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)

    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const unsupportedParts = mid.parts.filter(
      (p): p is SessionResume.Unsupported => p.type === "unsupported",
    )
    expect(unsupportedParts).toHaveLength(1)
    expect(unsupportedParts[0].reason).toBe("server_tool_result block")
  })

  test("rejects empty input", () => {
    expect(() => SessionResume.parseLines("")).toThrow(SessionResume.ParseError)
    expect(() => SessionResume.parseLines("   \n  ")).toThrow(SessionResume.ParseError)
  })

  test("rejects malformed JSON", () => {
    expect(() =>
      SessionResume.parseLines(
        '{"type":"user","version":"2.42.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"hi"}]}}\n{broken',
      ),
    ).toThrow(SessionResume.ParseError)
  })

  test("rejects a malformed JSON Lines file without returning partial history", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "resume-jsonl-"))
    try {
      const file = path.join(directory, "transcript.jsonl")
      fs.writeFileSync(
        file,
        [
          '{"type":"user","version":"2.42.0","message":{"role":"user","content":"Start"}}',
          "invalid-json",
          '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"text","text":"Done"}]}}',
        ].join("\n"),
      )

      await expect(SessionResume.parse(file)).rejects.toThrow("Line 2: invalid JSON")
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

// ── Codex parsing ────────────────────────────────────────────────────

describe("Codex parseLines", () => {
  test("parses simple user+assistant text exchange with real envelopes", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hi there!"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.format).toBe("codex")
    expect(result.version).toBe(0)
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0]).toEqual({
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    })
    expect(result.steps[1]).toEqual({
      role: "assistant",
      parts: [{ type: "text", text: "Hi there!" }],
    })
  })

  test("reads version from session_meta payload", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hi"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.version).toBe(0)
  })

  test("rejects Codex file without session_meta", () => {
    const text = [
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
    ].join("\n")

    expect(() => SessionResume.parseLines(text)).toThrow(SessionResume.ParseError)
  })

  test("rejects unsupported Codex major version", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"1.0.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
    ].join("\n")

    expect(() => SessionResume.parseLines(text)).toThrow(SessionResume.ParseError)
  })

  test("starts a new assistant step after a completed function call", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Read file"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"file\\":\\"foo.ts\\"}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"function_call_output","call_id":"call_1","output":"file contents"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(3)

    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const tc = mid.parts.find((p): p is SessionResume.ToolCall => p.type === "tool_call")
    const tr = mid.parts.find((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(tc).toBeDefined()
    expect(tc!.id).toBe("call_1")
    expect(tc!.name).toBe("read")
    expect(tc!.input).toEqual({ file: "foo.ts" })
    expect(tr).toBeDefined()
    expect(tr!.callID).toBe("call_1")
    expect(tr!.content).toBe("file contents")

    expect(result.steps[2]).toEqual({ role: "assistant", parts: [{ type: "text", text: "Done." }] })
  })

  test("one user with two complete tool rounds produces exact steps in source order", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Read then edit"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"c1","name":"read","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"function_call_output","call_id":"c1","output":"result1"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done reading. Now editing."}]}}',
      '{"type":"response_item","payload":{"id":"item_005","type":"function_call","call_id":"c2","name":"edit","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_006","type":"function_call_output","call_id":"c2","output":"result2"}}',
      '{"type":"response_item","payload":{"id":"item_007","type":"message","role":"assistant","content":[{"type":"output_text","text":"All done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(4)

    // Step 0: user
    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts).toEqual([{ type: "text", text: "Read then edit" }])

    // Step 1: first assistant tool round
    expect(result.steps[1].role).toBe("assistant")
    const step1Types = result.steps[1].parts.map((p) => p.type)
    expect(step1Types).toEqual(["tool_call", "tool_result"])
    const step1Call = result.steps[1].parts[0] as SessionResume.ToolCall
    expect(step1Call.id).toBe("c1")
    expect(step1Call.name).toBe("read")
    const step1Text = result.steps[2].parts[0] as SessionResume.TextPart
    expect(step1Text.text).toBe("Done reading. Now editing.")

    // Step 2 continues the new assistant step with the second tool round.
    const step2Types = result.steps[2].parts.map((p) => p.type)
    expect(step2Types).toEqual(["text", "tool_call", "tool_result"])
    const step2Call = result.steps[2].parts[1] as SessionResume.ToolCall
    expect(step2Call.id).toBe("c2")
    expect(step2Call.name).toBe("edit")
    const step2Text = result.steps[3].parts[0] as SessionResume.TextPart
    expect(step2Text.text).toBe("All done.")
  })

  test("pairs multiple tool calls with results", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Do two things"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"c1","name":"read","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"function_call","call_id":"c2","name":"edit","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"function_call_output","call_id":"c1","output":"r1"}}',
      '{"type":"response_item","payload":{"id":"item_005","type":"function_call_output","call_id":"c2","output":"r2"}}',
      '{"type":"response_item","payload":{"id":"item_006","type":"message","role":"assistant","content":[{"type":"output_text","text":"Both done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const calls = mid.parts.filter((p): p is SessionResume.ToolCall => p.type === "tool_call")
    const results = mid.parts.filter((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(calls).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect(calls.map((c) => c.id).sort()).toEqual(["c1", "c2"])
    expect(results.map((r) => r.callID).sort()).toEqual(["c1", "c2"])
  })

  test("converts unpaired Codex tool call to terminal error", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Go"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"orphan","name":"read","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"message","role":"user","content":[{"type":"input_text","text":"Next topic"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const errors = mid.parts.filter((p): p is SessionResume.ErrorPart => p.type === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("Unpaired tool call")
    expect(errors[0].message).toContain("orphan")
  })

  test("handles orphan tool output (no matching call)", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Go"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call_output","call_id":"no_match","output":"orphan"}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)
  })

  test("handles repeated call IDs across rounds", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"First"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"call_01","name":"read","arguments":"{\\"f\\":\\"a\\"}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"function_call_output","call_id":"call_01","output":"result a"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done first."}]}}',
      '{"type":"response_item","payload":{"id":"item_005","type":"message","role":"user","content":[{"type":"input_text","text":"Second"}]}}',
      '{"type":"response_item","payload":{"id":"item_006","type":"function_call","call_id":"call_01","name":"read","arguments":"{\\"f\\":\\"b\\"}"}}',
      '{"type":"response_item","payload":{"id":"item_007","type":"function_call_output","call_id":"call_01","output":"result b"}}',
      '{"type":"response_item","payload":{"id":"item_008","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done second."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const toolSteps = result.steps.filter(
      (s) => s.role === "assistant" && s.parts.some((p) => p.type === "tool_call"),
    )
    expect(toolSteps).toHaveLength(2)

    for (const step of toolSteps) {
      const tr = step.parts.find((p): p is SessionResume.ToolResult => p.type === "tool_result")
      expect(tr).toBeDefined()
      expect(tr!.callID).toBe("call_01")
    }
  })

  test("handles encrypted reasoning (empty summary)", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Think deeply"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"reasoning","summary":[]}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"message","role":"assistant","content":[{"type":"output_text","text":"Answer"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)
    expect(result.steps).toHaveLength(2)
  })

  test("counts empty assistant content as unsupported", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Test"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"message","role":"assistant","content":[]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.unsupported).toBe(1)
    expect(result.steps).toHaveLength(1) // only the user step
  })

  test("skips turn_context, event_msg, and world_state records", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
      '{"type":"turn_context","payload":{}}',
      '{"type":"event_msg","payload":{}}',
      '{"type":"world_state","payload":{}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"message","role":"assistant","content":[{"type":"output_text","text":"Hi"}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    expect(result.steps).toHaveLength(2)
  })

  test("handles partial tool results within one round", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Go"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"function_call","call_id":"ok","name":"ok","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"function_call","call_id":"missing","name":"missing","arguments":"{}"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"function_call_output","call_id":"ok","output":"done"}}',
      '{"type":"response_item","payload":{"id":"item_005","type":"message","role":"user","content":[{"type":"input_text","text":"Continuing."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const results = mid.parts.filter((p): p is SessionResume.ToolResult => p.type === "tool_result")
    const errors = mid.parts.filter((p): p is SessionResume.ErrorPart => p.type === "error")

    expect(results).toHaveLength(1)
    expect(results[0].callID).toBe("ok")
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("missing")
  })

  test("handles custom_tool_call and custom_tool_call_output", () => {
    const text = [
      '{"type":"session_meta","payload":{"cli_version":"0.8.0","cwd":"/test"}}',
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Run custom tool"}]}}',
      '{"type":"response_item","payload":{"id":"item_002","type":"custom_tool_call","call_id":"ct_01","name":"my-tool","input":{"key":"value"}}}',
      '{"type":"response_item","payload":{"id":"item_003","type":"custom_tool_call_output","call_id":"ct_01","output":"custom result"}}',
      '{"type":"response_item","payload":{"id":"item_004","type":"message","role":"assistant","content":[{"type":"output_text","text":"Done."}]}}',
    ].join("\n")

    const result = SessionResume.parseLines(text)
    const mid = result.steps[1]
    expect(mid.role).toBe("assistant")
    const tc = mid.parts.find((p): p is SessionResume.ToolCall => p.type === "tool_call")
    expect(tc).toBeDefined()
    expect(tc!.id).toBe("ct_01")
    expect(tc!.name).toBe("my-tool")
    expect(tc!.input).toEqual({ key: "value" })

    const tr = mid.parts.find((p): p is SessionResume.ToolResult => p.type === "tool_result")
    expect(tr).toBeDefined()
    expect(tr!.callID).toBe("ct_01")
    expect(tr!.content).toBe("custom result")
  })

  test("rejects empty input", () => {
    expect(() => SessionResume.parseLines("")).toThrow(SessionResume.ParseError)
  })

  test("rejects malformed JSON", () => {
    expect(() =>
      SessionResume.parseLines(
        '{"type":"session_meta","payload":{"cli_version":"0.8.0"}}\n{broken',
      ),
    ).toThrow(SessionResume.ParseError)
  })
})

// ── Discovery ────────────────────────────────────────────────────

describe("SessionResume discovery", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000"

  test("uses the Claude project slug and injected root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-claude-"))
    try {
      const cwd = "/Users/test/project"
      const directory = path.join(root, SessionResume.claudeProjectSlug(cwd))
      fs.mkdirSync(directory, { recursive: true })
      const expected = path.join(directory, `${id}.jsonl`)
      fs.writeFileSync(expected, "{}")

      expect(SessionResume.discoverClaude({ claude: root, cwd, id })).toEqual([expected])
      expect(() => SessionResume.discoverClaude({ claude: root, cwd, id: "bad" })).toThrow(
        SessionResume.ParseError,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("lists only UUID Claude transcript names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-claude-"))
    try {
      const cwd = "/Users/test/project"
      const directory = path.join(root, SessionResume.claudeProjectSlug(cwd))
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, "agent.jsonl"), "{}")
      fs.writeFileSync(path.join(directory, "550e8400-e29b-41d4-a716-446655440000.jsonl"), "{}")

      expect(SessionResume.discoverClaude({ claude: root, cwd }).map((file) => path.basename(file))).toEqual([
        "550e8400-e29b-41d4-a716-446655440000.jsonl",
      ])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("scans Codex rollouts from an injected root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-codex-"))
    try {
      const directory = path.join(root, "2026", "08", "03")
      fs.mkdirSync(directory, { recursive: true })
      const expected = path.join(directory, `rollout-2026-08-03T10-00-00-${id}.jsonl`)
      fs.writeFileSync(expected, '{"type":"session_meta","payload":{"cwd":"/repo"}}\n')

      await expect(SessionResume.discoverCodex({ codex: root, cwd: "/repo", id })).resolves.toEqual([expected])
      await expect(SessionResume.discoverCodex({ codex: root, cwd: "/repo", id: "bad" })).rejects.toThrow(
        SessionResume.ParseError,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("scans a Codex rollout stored at the sessions root", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-codex-"))
    try {
      const expected = path.join(root, `rollout-2026-08-03T10-00-00-${id}.jsonl`)
      fs.writeFileSync(expected, '{"type":"session_meta","payload":{"cwd":"/repo"}}\n')

      await expect(SessionResume.discoverCodex({ codex: root, cwd: "/repo", id })).resolves.toEqual([expected])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test("no-ID discovery matches cwd with backslash-separated paths (Windows)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-codex-"))
    try {
      const cwd = "C:\\Users\\dev\\project"
      const file = path.join(root, `rollout-2026-08-03T10-00-00-${id}.jsonl`)
      // Escaped backslashes in JSON are valid on all platforms
      fs.writeFileSync(file, '{"type":"session_meta","payload":{"cwd":"C:\\\\Users\\\\dev\\\\project"}}\n')

      await expect(SessionResume.discoverCodex({ codex: root, cwd })).resolves.toEqual([file])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

// ── Full file parsing ────────────────────────────────────────────

describe("parse file", () => {
  test("parses claude.jsonl fixture with exact step count", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/claude.jsonl",
    )
    expect(result.format).toBe("claude")
    expect(result.version).toBe(2)

    // 13 steps: user + 6 assistant tool rounds + interleaved text assistants
    expect(result.steps.length).toBe(13)

    // First step is user
    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts[0].type).toBe("text")

    // Steps alternate between user and assistant
    const roles = result.steps.map((s) => s.role)
    expect(roles[0]).toBe("user")

    // Has tool calls in at least 3 distinct steps
    const toolSteps = result.steps.filter((s) =>
      s.parts.some((p) => p.type === "tool_call"),
    )
    expect(toolSteps.length).toBeGreaterThanOrEqual(3)

    // Has reasoning
    const reasoningSteps = result.steps.filter((s) =>
      s.parts.some((p) => p.type === "reasoning"),
    )
    expect(reasoningSteps.length).toBeGreaterThanOrEqual(1)

    // Unsported content: redacted_thinking + custom_block + server_tool_result in user msg_017
    expect(result.unsupported).toBe(3)
  })

  test("parses codex.jsonl fixture with exact step count", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/codex.jsonl",
    )
    expect(result.format).toBe("codex")
    expect(result.version).toBe(0)

    expect(result.steps.length).toBe(14)

    // First step is user
    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts[0].type).toBe("text")

    // Has both user and assistant
    const roleSet = new Set(result.steps.map((s) => s.role))
    expect(roleSet.has("user")).toBe(true)
    expect(roleSet.has("assistant")).toBe(true)

    // Has tool calls in multiple steps (two distinct tool rounds)
    const toolSteps = result.steps.filter((s) =>
      s.parts.some((p) => p.type === "tool_call"),
    )
    expect(toolSteps.length).toBeGreaterThanOrEqual(2)

    // Has unsupported content from encrypted reasoning + empty assistant
    expect(result.unsupported).toBeGreaterThanOrEqual(2)
  })

  test("codex fixture: first user produces two complete assistant tool rounds", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/codex.jsonl",
    )

    // Step 0: user
    expect(result.steps[0].role).toBe("user")
    expect(result.steps[0].parts[0].type).toBe("text")

    // Step 1: first completed tool round.
    expect(result.steps[1].role).toBe("assistant")
    const step1Types = result.steps[1].parts.map((p) => p.type)
    expect(step1Types).toContain("tool_call")
    expect(step1Types).toContain("tool_result")
    const step1Call = result.steps[1].parts.find(
      (p): p is SessionResume.ToolCall => p.type === "tool_call",
    )
    expect(step1Call).toBeDefined()
    expect(step1Call!.name).toBe("read")

    // Step 2 starts the next assistant content and tool round.
    expect(result.steps[2].role).toBe("assistant")
    const step2Calls = result.steps[2].parts.filter(
      (p): p is SessionResume.ToolCall => p.type === "tool_call",
    )
    expect(step2Calls.length).toBe(2)
    const step2Results = result.steps[2].parts.filter(
      (p): p is SessionResume.ToolResult => p.type === "tool_result",
    )
    expect(step2Results.length).toBe(2)
    const step2Texts = result.steps[2].parts.filter(
      (p): p is SessionResume.TextPart => p.type === "text",
    )
    expect(step2Texts.length).toBeGreaterThanOrEqual(1)
  })

  test("claude fixture: consecutive assistants before tool result merged into one step", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/claude.jsonl",
    )

    // msg_018 (redacted_thinking), msg_019 (custom_block), msg_020 (tool_use)
    // should be merged into a single assistant step
    const lastAssistant = result.steps[result.steps.length - 1]
    expect(lastAssistant.role).toBe("assistant")

    const partTypes = lastAssistant.parts.map((p) => p.type)
    // Should contain unsupported, unsupported, tool_call, error (from markUnpaired)
    expect(partTypes.filter((t) => t === "unsupported").length).toBe(2)
    expect(partTypes.filter((t) => t === "tool_call").length).toBe(1)
    expect(partTypes.filter((t) => t === "error").length).toBe(1)
  })

  test("claude fixture: sidechain and metadata records excluded", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/claude.jsonl",
    )

    // The fixture has 22 lines total, but 2 are metadata/sidechain records
    // (ai-title line 7, last-prompt line 14)
    // Verify no step contains sidechain text
    for (const step of result.steps) {
      for (const part of step.parts) {
        if (part.type === "text") {
          expect(part.text).not.toContain("Session title")
        }
      }
    }
  })

  test("claude fixture: repeated IDs across rounds handled correctly", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/claude.jsonl",
    )

    // toolu_01 appears in two different rounds (msg_002 and msg_014)
    const toolSteps = result.steps.filter(
      (s) =>
        s.role === "assistant" &&
        s.parts.some((p) => p.type === "tool_call" && p.id === "toolu_01"),
    )
    expect(toolSteps.length).toBe(2)
  })

  test("codex fixture: repeated call IDs across rounds", async () => {
    const result = await SessionResume.parse(
      __dirname + "/fixture/session-resume/codex.jsonl",
    )

    // call_01 appears in two different rounds
    const call01Steps = result.steps.filter(
      (s) =>
        s.role === "assistant" &&
        s.parts.some((p) => p.type === "tool_call" && p.id === "call_01"),
    )
    expect(call01Steps.length).toBe(2)
  })

  test("codex fixture: missing session_meta is rejected", () => {
    const text = [
      '{"type":"response_item","payload":{"id":"item_001","type":"message","role":"user","content":[{"type":"input_text","text":"Hello"}]}}',
    ].join("\n")

    expect(() => SessionResume.parseLines(text)).toThrow(SessionResume.ParseError)
  })

  test("rejects missing file", async () => {
    await expect(SessionResume.parse("/nonexistent/file.jsonl")).rejects.toThrow()
  })
})

// ── Unrecognized format rejection ────────────────────────────────

describe("rejection", () => {
  test("rejects unrecognized format", () => {
    expect(() => SessionResume.parseLines('[1,2,3]')).toThrow(SessionResume.ParseError)
    expect(() => SessionResume.parseLines('{"key":"value"}')).toThrow(SessionResume.ParseError)
  })
})
