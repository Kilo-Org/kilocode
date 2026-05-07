// Unit tests for KiloSessionPrompt history-trim / media-strip helpers.
// Covers the post-filterCompacted safety pass that unblocks sessions stuck
// re-shipping multi-MB base-64 images after a successful summary.

import { describe, expect, test } from "bun:test"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_safety")

function userInfo(id: string): MessageV2.User {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "test",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    tools: {},
    mode: "",
  } as unknown as MessageV2.User
}

function assistantInfo(
  id: string,
  parentID: string,
  opts?: { summary?: boolean; finish?: string; error?: MessageV2.Assistant["error"] },
): MessageV2.Assistant {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make(parentID),
    modelID: ModelID.make("test"),
    providerID: ProviderID.make("test"),
    mode: "",
    agent: "test",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    summary: opts?.summary,
    finish: opts?.finish,
    error: opts?.error,
  } as unknown as MessageV2.Assistant
}

function textPart(messageID: string, text: string, partID = "p_" + messageID): MessageV2.TextPart {
  return {
    id: PartID.make(partID),
    sessionID,
    messageID: MessageID.make(messageID),
    type: "text",
    text,
  }
}

function syntheticTextPart(messageID: string, text: string, partID = "p_syn_" + messageID): MessageV2.TextPart {
  return {
    id: PartID.make(partID),
    sessionID,
    messageID: MessageID.make(messageID),
    type: "text",
    text,
    synthetic: true,
  }
}

function filePart(
  messageID: string,
  mime: string,
  filename: string | undefined,
  partID = "p_file_" + messageID,
): MessageV2.FilePart {
  return {
    id: PartID.make(partID),
    sessionID,
    messageID: MessageID.make(messageID),
    type: "file",
    mime,
    filename,
    url: "data:" + mime + ";base64,AAAA",
  }
}

function toolPart(
  messageID: string,
  status: "completed" | "error" | "pending" | "running",
  attachments?: MessageV2.FilePart[],
  partID = "p_tool_" + messageID,
): MessageV2.ToolPart {
  const state = (() => {
    if (status === "completed") {
      return {
        status: "completed" as const,
        input: {},
        output: "done",
        title: "tool",
        metadata: {},
        time: { start: 0, end: 1 },
        attachments,
      }
    }
    if (status === "error") {
      return {
        status: "error" as const,
        input: {},
        error: "boom",
        time: { start: 0, end: 1 },
      }
    }
    if (status === "running") {
      return {
        status: "running" as const,
        input: {},
        title: "tool",
        time: { start: 0 },
      }
    }
    return {
      status: "pending" as const,
      input: {},
      raw: "{}",
    }
  })()
  return {
    id: PartID.make(partID),
    sessionID,
    messageID: MessageID.make(messageID),
    type: "tool",
    callID: "c_" + partID,
    tool: "read",
    state,
  }
}

function user(id: string, parts: MessageV2.Part[] = []): MessageV2.WithParts {
  return { info: userInfo(id), parts }
}

function assistant(
  id: string,
  parentID: string,
  parts: MessageV2.Part[] = [],
  opts?: { summary?: boolean; finish?: string; error?: MessageV2.Assistant["error"] },
): MessageV2.WithParts {
  return { info: assistantInfo(id, parentID, opts), parts }
}

const apiError = new MessageV2.APIError({
  message: "boom",
  isRetryable: true,
}).toObject() as MessageV2.Assistant["error"]

describe("KiloSessionPrompt.hasCompletedSummary", () => {
  test("returns false for empty array", () => {
    expect(KiloSessionPrompt.hasCompletedSummary([])).toBe(false)
  })

  test("returns false when only summary has an error", () => {
    const msgs = [
      user("msg_u1"),
      assistant("msg_a1", "msg_u1", [], { summary: true, finish: "end_turn", error: apiError }),
    ]
    expect(KiloSessionPrompt.hasCompletedSummary(msgs)).toBe(false)
  })

  test("returns false when summary lacks finish", () => {
    const msgs = [user("msg_u1"), assistant("msg_a1", "msg_u1", [], { summary: true })]
    expect(KiloSessionPrompt.hasCompletedSummary(msgs)).toBe(false)
  })

  test("returns true when summary has finish and no error", () => {
    const msgs = [user("msg_u1"), assistant("msg_a1", "msg_u1", [], { summary: true, finish: "end_turn" })]
    expect(KiloSessionPrompt.hasCompletedSummary(msgs)).toBe(true)
  })
})

describe("KiloSessionPrompt.trimBeforeLastSummary", () => {
  test("returns input unchanged when no summary present", () => {
    const msgs = [user("msg_u1"), assistant("msg_a1", "msg_u1", [], { finish: "end_turn" })]
    const result = KiloSessionPrompt.trimBeforeLastSummary(msgs)
    expect(result).toBe(msgs)
  })

  test("trims to summary's text-user parent (reference-session bug)", () => {
    // Simulates manual /compact against a plain text user ("status?"):
    // pre-summary history starts at msg_early, the summary's parent is a text
    // user msg_status with no compaction part, and filterCompacted never trims.
    const msgs = [
      user("msg_early", [textPart("msg_early", "original question")]),
      assistant("msg_reply", "msg_early", [textPart("msg_reply", "original reply")], { finish: "end_turn" }),
      user("msg_status", [textPart("msg_status", "status?")]),
      assistant("msg_summary", "msg_status", [textPart("msg_summary", "summary body")], {
        summary: true,
        finish: "end_turn",
      }),
      user("msg_next", [textPart("msg_next", "next prompt")]),
    ]
    const filtered = MessageV2.filterCompacted([...msgs].reverse())
    expect(filtered.map((m) => m.info.id)).toEqual(msgs.map((m) => m.info.id))

    const result = KiloSessionPrompt.trimBeforeLastSummary(filtered)
    expect(result.map((m) => m.info.id)).toEqual([
      MessageID.make("msg_status"),
      MessageID.make("msg_summary"),
      MessageID.make("msg_next"),
    ])
  })

  test("trims at newest successful summary when multiple are present", () => {
    const msgs = [
      user("msg_u1"),
      assistant("msg_s1", "msg_u1", [], { summary: true, finish: "end_turn" }),
      user("msg_u2"),
      assistant("msg_a2", "msg_u2", [], { finish: "end_turn" }),
      user("msg_u3"),
      assistant("msg_s3", "msg_u3", [], { summary: true, finish: "end_turn" }),
      user("msg_u4"),
    ]
    const result = KiloSessionPrompt.trimBeforeLastSummary(msgs)
    expect(result.map((m) => m.info.id)).toEqual([
      MessageID.make("msg_u3"),
      MessageID.make("msg_s3"),
      MessageID.make("msg_u4"),
    ])
  })

  test("ignores errored and unfinished summaries when choosing boundary", () => {
    const msgs = [
      user("msg_u1"),
      assistant("msg_s1", "msg_u1", [], { summary: true, finish: "end_turn" }),
      user("msg_u2"),
      // errored summary should be skipped
      assistant("msg_s2", "msg_u2", [], { summary: true, finish: "end_turn", error: apiError }),
      user("msg_u3"),
      // unfinished summary should be skipped
      assistant("msg_s3", "msg_u3", [], { summary: true }),
      user("msg_u4"),
    ]
    const result = KiloSessionPrompt.trimBeforeLastSummary(msgs)
    // newest valid summary is msg_s1 with parent msg_u1 (index 0) → no slicing
    expect(result).toBe(msgs)
  })

  test("is idempotent", () => {
    const msgs = [
      user("msg_early"),
      assistant("msg_reply", "msg_early", [], { finish: "end_turn" }),
      user("msg_status"),
      assistant("msg_summary", "msg_status", [], { summary: true, finish: "end_turn" }),
      user("msg_next"),
    ]
    const first = KiloSessionPrompt.trimBeforeLastSummary(msgs)
    const second = KiloSessionPrompt.trimBeforeLastSummary(first)
    expect(second.map((m) => m.info.id)).toEqual(first.map((m) => m.info.id))
  })

  test("returns input unchanged when summary's parent is missing", () => {
    const msgs = [
      user("msg_u1"),
      assistant("msg_summary", "msg_missing", [], { summary: true, finish: "end_turn" }),
      user("msg_next"),
    ]
    const result = KiloSessionPrompt.trimBeforeLastSummary(msgs)
    expect(result).toBe(msgs)
  })
})

describe("KiloSessionPrompt.stripHistoricalMedia", () => {
  test("replaces image file part in historical user message with placeholder text", () => {
    const msgs = [
      user("msg_hist", [textPart("msg_hist", "here is a screenshot"), filePart("msg_hist", "image/png", "screen.png")]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    const histParts = result[0].parts
    expect(histParts).toHaveLength(2)
    expect(histParts[1].type).toBe("text")
    expect((histParts[1] as MessageV2.TextPart).text).toBe("[Attached image/png: screen.png]")
  })

  test("falls back to 'file' when filename is missing", () => {
    const msgs = [
      user("msg_hist", [filePart("msg_hist", "image/png", undefined)]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect((result[0].parts[0] as MessageV2.TextPart).text).toBe("[Attached image/png: file]")
  })

  test("replaces historical PDF file part with placeholder text", () => {
    const msgs = [
      user("msg_hist", [filePart("msg_hist", "application/pdf", "brief.pdf")]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result[0].parts[0].type).toBe("text")
    expect((result[0].parts[0] as MessageV2.TextPart).text).toBe("[Attached application/pdf: brief.pdf]")
  })

  test("does NOT touch media in the last user message", () => {
    const lastImage = filePart("msg_last", "image/png", "last.png")
    const msgs = [user("msg_hist", [textPart("msg_hist", "older")]), user("msg_last", [lastImage])]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result[1].parts[0]).toBe(lastImage)
  })

  test("does NOT touch text/plain or directory file parts", () => {
    const textFile = filePart("msg_hist", "text/plain", "notes.txt", "p_txt")
    const dirFile = filePart("msg_hist", "application/x-directory", "src/", "p_dir")
    const msgs = [user("msg_hist", [textFile, dirFile]), user("msg_last", [textPart("msg_last", "follow-up")])]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result[0].parts[0]).toBe(textFile)
    expect(result[0].parts[1]).toBe(dirFile)
  })

  test("filters media attachments out of completed tool parts, keeps non-media", () => {
    const imageAtt = filePart("msg_tool", "image/png", "shot.png", "p_att_img")
    const textAtt = filePart("msg_tool", "text/plain", "data.txt", "p_att_txt")
    const pdfAtt = filePart("msg_tool", "application/pdf", "doc.pdf", "p_att_pdf")
    const tool = toolPart("msg_tool", "completed", [imageAtt, textAtt, pdfAtt])
    const msgs = [
      user("msg_u1", [textPart("msg_u1", "question")]),
      assistant("msg_tool", "msg_u1", [tool], { finish: "end_turn" }),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    const resultTool = result[1].parts[0] as MessageV2.ToolPart
    if (resultTool.state.status !== "completed") throw new Error("expected completed tool state")
    expect(resultTool.state.attachments).toHaveLength(1)
    expect(resultTool.state.attachments?.[0].mime).toBe("text/plain")
    // other tool-state fields preserved
    expect(resultTool.state.output).toBe("done")
    expect(resultTool.state.title).toBe("tool")
  })

  test("does NOT touch non-completed tool parts", () => {
    const err = toolPart("msg_error", "error")
    const pending = toolPart("msg_pending", "pending")
    const running = toolPart("msg_running", "running")
    const msgs = [
      user("msg_u1", [textPart("msg_u1", "question")]),
      assistant("msg_error", "msg_u1", [err], { finish: "end_turn" }),
      assistant("msg_pending", "msg_u1", [pending], { finish: "end_turn" }),
      assistant("msg_running", "msg_u1", [running], { finish: "end_turn" }),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result[1].parts[0]).toBe(err)
    expect(result[2].parts[0]).toBe(pending)
    expect(result[3].parts[0]).toBe(running)
  })

  test("no-op when there are no user messages", () => {
    const msgs = [assistant("msg_a1", "msg_ghost", [], { finish: "end_turn" })]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result).toBe(msgs)
  })

  test("no-op when there is only one user message", () => {
    const lastImage = filePart("msg_only", "image/png", "only.png")
    const msgs = [user("msg_only", [lastImage])]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result).toBe(msgs)
    expect(result[0].parts[0]).toBe(lastImage)
  })

  test("does not mutate the input", () => {
    const histImage = filePart("msg_hist", "image/png", "hist.png")
    const histParts = [textPart("msg_hist", "older"), histImage]
    const input: MessageV2.WithParts[] = [
      user("msg_hist", histParts),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const inputSnapshot = input
    const firstMsgSnapshot = input[0]
    const firstPartsSnapshot = input[0].parts

    const result = KiloSessionPrompt.stripHistoricalMedia(input)

    // result is a new array, original unchanged
    expect(result).not.toBe(input)
    expect(input).toBe(inputSnapshot)
    expect(input[0]).toBe(firstMsgSnapshot)
    expect(input[0].parts).toBe(firstPartsSnapshot)
    expect(input[0].parts[1]).toBe(histImage)
    expect(histImage.type).toBe("file")
  })

  test("skips synthetic-only user turns when picking the cutoff", () => {
    // Repro of the handleSubtask() scenario: the real user just attached an
    // image, then a task command completed and appended the synthetic
    // "Summarize the task tool output above..." user turn. On the next
    // runLoop pass the synthetic user must NOT be treated as the current
    // turn, otherwise the real user's image gets stripped mid-turn.
    const currentImage = filePart("msg_current", "image/png", "current.png")
    const msgs = [
      user("msg_hist", [textPart("msg_hist", "older"), filePart("msg_hist", "image/png", "old.png")]),
      assistant("msg_a", "msg_hist", [], { finish: "end_turn" }),
      user("msg_current", [textPart("msg_current", "check this"), currentImage]),
      assistant("msg_subtask", "msg_current", [], { finish: "tool-calls" }),
      user("msg_syn", [
        syntheticTextPart("msg_syn", "Summarize the task tool output above and continue with your task."),
      ]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    // real current-turn user's image preserved
    expect(result[2].parts[1]).toBe(currentImage)
    // older user's image stripped
    const histFilePart = result[0].parts[1]
    expect(histFilePart.type).toBe("text")
    expect((histFilePart as MessageV2.TextPart).text).toBe("[Attached image/png: old.png]")
    // synthetic user preserved as-is
    expect(result[4]).toBe(msgs[4])
  })

  test("skips synthetic user turns with injected context when picking the cutoff", () => {
    const currentImage = filePart("msg_current", "image/png", "current.png")
    const msgs = [
      user("msg_hist", [textPart("msg_hist", "older"), filePart("msg_hist", "image/png", "old.png")]),
      user("msg_current", [textPart("msg_current", "check this"), currentImage]),
      user("msg_syn", [
        syntheticTextPart("msg_syn", "Summarize the task tool output above and continue with your task."),
        syntheticTextPart("msg_syn", "<environment_details>\nCurrent time: now\n</environment_details>", "p_env"),
      ]),
    ]
    const result = KiloSessionPrompt.stripHistoricalMedia(msgs)
    expect(result[1].parts[1]).toBe(currentImage)
    const hist = result[0].parts[1]
    expect(hist.type).toBe("text")
    expect((hist as MessageV2.TextPart).text).toBe("[Attached image/png: old.png]")
  })
})

describe("KiloSessionPrompt.maybeStripHistoricalMedia", () => {
  test("returns input unchanged when no completed summary exists", () => {
    const msgs = [
      user("msg_hist", [filePart("msg_hist", "image/png", "hist.png")]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.maybeStripHistoricalMedia(msgs)
    expect(result).toBe(msgs)
  })

  test("returns input unchanged when summaries are errored or unfinished", () => {
    const image = filePart("msg_hist", "image/png", "hist.png")
    const msgs = [
      user("msg_u1", [textPart("msg_u1", "status?")]),
      assistant("msg_error", "msg_u1", [], { summary: true, finish: "end_turn", error: apiError }),
      user("msg_u2", [textPart("msg_u2", "again")]),
      assistant("msg_unfinished", "msg_u2", [], { summary: true }),
      user("msg_hist", [image]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.maybeStripHistoricalMedia(msgs)
    expect(result).toBe(msgs)
    expect(result[4].parts[0]).toBe(image)
  })

  test("strips history when a completed summary exists", () => {
    const msgs = [
      user("msg_status", [textPart("msg_status", "status?")]),
      assistant("msg_summary", "msg_status", [textPart("msg_summary", "summary body")], {
        summary: true,
        finish: "end_turn",
      }),
      user("msg_hist", [filePart("msg_hist", "image/png", "hist.png")]),
      user("msg_last", [textPart("msg_last", "follow-up")]),
    ]
    const result = KiloSessionPrompt.maybeStripHistoricalMedia(msgs)
    // historical image replaced
    const histPart = result[2].parts[0]
    expect(histPart.type).toBe("text")
    expect((histPart as MessageV2.TextPart).text).toBe("[Attached image/png: hist.png]")
    // last user untouched
    expect(result[3].parts[0].type).toBe("text")
  })
})
