// Unit tests for KiloSessionCompaction.continuePrompt (#34)
// Verifies that sub-agent compaction continue prompts include the original task
// and that synthetic parts are excluded to prevent multi-round nesting bloat.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { KiloSessionCompaction } from "../../src/kilocode/session/compaction"
import { KiloSession } from "../../src/kilocode/session"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { SessionV1 } from "@opencode-ai/core/v1/session"

const rootSessionID = SessionID.make("ses_root_34")
const childSessionID = SessionID.make("ses_child_34")

function userMessage(id: string, sid: string): SessionV1.User {
  return {
    id: MessageID.make(id),
    sessionID: SessionID.make(sid),
    role: "user",
    time: { created: 0 },
    agent: "general",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
  } as unknown as SessionV1.User
}

function textPart(messageID: string, text: string, synthetic = false): SessionV1.TextPart {
  return {
    id: PartID.make("prt_" + messageID + (synthetic ? "_syn" : "")),
    sessionID: childSessionID,
    messageID: MessageID.make(messageID),
    type: "text",
    text,
    ...(synthetic ? { synthetic: true } : {}),
  } as unknown as SessionV1.TextPart
}

function compactionPart(messageID: string): SessionV1.CompactionPart {
  return {
    id: PartID.make("prt_compact_" + messageID),
    sessionID: childSessionID,
    messageID: MessageID.make(messageID),
    type: "compaction",
    auto: true,
  } as unknown as SessionV1.CompactionPart
}

function assistantMessage(id: string, parentID: string): SessionV1.Assistant {
  return {
    id: MessageID.make(id),
    sessionID: childSessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make(parentID),
    modelID: ModelV2.ID.make("test"),
    providerID: ProviderV2.ID.make("test"),
    mode: "general",
    agent: "general",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    summary: true,
    finish: "stop",
  } as unknown as SessionV1.Assistant
}

function withParts(info: SessionV1.User | SessionV1.Assistant, parts: SessionV1.Part[]): SessionV1.WithParts {
  return { info, parts } as SessionV1.WithParts
}

describe("KiloSessionCompaction.continuePrompt (#34)", () => {
  beforeEach(() => {
    // Register the child session under the root parent
    KiloSession.register({ id: childSessionID, parentID: rootSessionID })
  })

  afterEach(() => {
    // Clean up global registry to avoid cross-test pollution
    KiloSession.clearPlatformOverride(childSessionID)
  })

  test("returns undefined for root sessions (no parent)", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", rootSessionID), [
        textPart("msg_1", "Review the code changes"),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: rootSessionID,
      messages,
    })
    expect(result).toBeUndefined()
  })

  test("returns modified prompt with original task for child sessions", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1", "Review the business logic of the npm to pnpm migration. Return NO_FINDINGS if no issues."),
      ]),
      withParts(assistantMessage("msg_2", "msg_1"), [textPart("msg_2", "Summary of work done")]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeDefined()
    expect(result!).toContain("<original_task>")
    expect(result!).toContain("Review the business logic")
    expect(result!).toContain("NO_FINDINGS")
    expect(result!).toContain("</original_task>")
    expect(result!).toContain("sub-agent")
  })

  test("excludes synthetic continue messages to prevent multi-round nesting", () => {
    // Simulate state after first compaction: original task + compaction summary +
    // synthetic continue message (from round 1) + new compaction (round 2)
    const originalTask = "Review the code. Return NO_FINDINGS if no issues."
    const syntheticContinueText =
      "<original_task>\nReview the code.\n</original_task>\nYou are a sub-agent..."

    const messages: SessionV1.WithParts[] = [
      // Index 0: original task (non-synthetic)
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1", originalTask),
      ]),
      // Index 1: compaction user message (has compaction part)
      withParts(userMessage("msg_2", childSessionID), [compactionPart("msg_2")]),
      // Index 2: compaction assistant summary
      withParts(assistantMessage("msg_3", "msg_2"), [textPart("msg_3", "Compacted summary")]),
      // Index 3: synthetic continue message from round 1
      withParts(userMessage("msg_4", childSessionID), [
        textPart("msg_4", syntheticContinueText, true), // synthetic: true
      ]),
      // Index 4: new compaction user message (round 2)
      withParts(userMessage("msg_5", childSessionID), [compactionPart("msg_5")]),
    ]

    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeDefined()
    // Should contain the original task from index 0, NOT the synthetic continue from index 3
    expect(result!).toContain(originalTask)
    // Should NOT contain the synthetic continue's nested content
    expect(result!).not.toContain("You are a sub-agent...")
    // The <original_task> tag should wrap the original task text (from index 0),
    // not the synthetic text (from index 3 which starts with "<original_task>")
    // Count actual wrapping tags by checking the extracted content
    const taskMatch = result!.match(/<original_task>\n([\s\S]*?)\n<\/original_task>/)
    expect(taskMatch).not.toBeNull()
    expect(taskMatch![1]).toBe(originalTask)
  })

  test("returns undefined when no non-synthetic non-compaction user message exists", () => {
    // All user messages are either compaction or synthetic
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [compactionPart("msg_1")]),
      withParts(assistantMessage("msg_2", "msg_1"), [textPart("msg_2", "Summary")]),
      withParts(userMessage("msg_3", childSessionID), [
        textPart("msg_3", "Continue prompt", true), // synthetic
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeUndefined()
  })

  test("truncates long original tasks to prevent context bloat", () => {
    const longText = "A".repeat(5000) // Exceeds 4000 char limit
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1", longText),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeDefined()
    // The truncated text should be at most 4000 chars + "[truncated]"
    const taskMatch = result!.match(/<original_task>\n([\s\S]*?)\n<\/original_task>/)
    expect(taskMatch).not.toBeNull()
    const extracted = taskMatch![1]
    expect(extracted.length).toBeLessThanOrEqual(4000 + "[truncated]".length + 1)
    expect(extracted).toContain("[truncated]")
  })

  test("includes overflow prefix when overflow flag is set", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1", "Review the code"),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
      overflow: true,
    })
    expect(result).toBeDefined()
    expect(result!).toContain("exceeded the provider's size limit")
  })

  test("does not include overflow prefix when overflow flag is not set", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1", "Review the code"),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
      overflow: false,
    })
    expect(result).toBeDefined()
    expect(result!).not.toContain("exceeded the provider's size limit")
  })

  test("filters out ignored text parts from original task", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        // ignored part should be excluded
        { ...textPart("msg_1a", "[ignored marker]"), ignored: true } as SessionV1.TextPart,
        // non-ignored part should be included
        textPart("msg_1b", "Review the code. Return NO_FINDINGS if no issues."),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeDefined()
    expect(result!).toContain("Review the code")
    expect(result!).not.toContain("[ignored marker]")
  })

  test("handles multi-part original task messages", () => {
    const messages: SessionV1.WithParts[] = [
      withParts(userMessage("msg_1", childSessionID), [
        textPart("msg_1a", "Part 1 of the task"),
        textPart("msg_1b", "Part 2 of the task"),
      ]),
    ]
    const result = KiloSessionCompaction.continuePrompt({
      sessionID: childSessionID,
      messages,
    })
    expect(result).toBeDefined()
    expect(result!).toContain("Part 1 of the task")
    expect(result!).toContain("Part 2 of the task")
  })
})
