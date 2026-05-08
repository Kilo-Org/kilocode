import { describe, expect, test } from "bun:test"
import { KiloCommandSubtasks } from "../../src/kilocode/command/subtasks"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"

const sessionID = SessionID.descending()
const messageID = MessageID.ascending()
const prompt = "Review this change"

function user(parts: MessageV2.SubtaskPart[]): MessageV2.WithParts {
  return {
    info: {
      id: messageID,
      role: "user",
      sessionID,
      agent: "code",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("main") },
      time: { created: Date.now() },
    },
    parts,
  }
}

function part(input: MessageV2.SubtaskPartInput): MessageV2.SubtaskPart {
  return {
    ...input,
    id: PartID.ascending(),
    sessionID,
    messageID,
  }
}

function tool(task: MessageV2.SubtaskPart): MessageV2.ToolPart {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID: MessageID.ascending(),
    type: "tool",
    callID: "call-test",
    tool: "task",
    state: {
      status: "completed",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
      },
      output: "done",
      title: task.description,
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

describe("KiloCommandSubtasks", () => {
  test("builds subtask parts with explicit per-reviewer models", () => {
    const parts = KiloCommandSubtasks.build({
      command: "multi-review",
      prompt,
      subtasks: [
        { agent: "review-gpt", model: "openai/gpt-test", description: "gpt" },
        { agent: "review-opus", model: "anthropic/opus-test", description: "opus" },
      ],
    })

    expect(parts).toEqual([
      {
        type: "subtask",
        agent: "review-gpt",
        description: "gpt",
        command: "multi-review",
        model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-test") },
        prompt,
      },
      {
        type: "subtask",
        agent: "review-opus",
        description: "opus",
        command: "multi-review",
        model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("opus-test") },
        prompt,
      },
    ])
  })

  test("uses command-level model as fallback", () => {
    const parts = KiloCommandSubtasks.build({
      command: "multi-review",
      prompt,
      model: "test/fallback",
      subtasks: [{ agent: "reviewer" }],
    })

    expect(parts[0].model).toEqual({ providerID: ProviderID.make("test"), modelID: ModelID.make("fallback") })
  })

  test("omits model when neither subtask nor command model is set", () => {
    const parts = KiloCommandSubtasks.build({
      command: "multi-review",
      prompt,
      subtasks: [{ agent: "reviewer" }],
    })

    expect(parts[0].model).toBeUndefined()
  })

  test("excludes already-completed task wrappers from pending batches", () => {
    const parts = KiloCommandSubtasks.build({
      command: "multi-review",
      prompt,
      subtasks: [
        { agent: "review-gpt", model: "test/gpt", description: "gpt" },
        { agent: "review-opus", model: "test/opus", description: "opus" },
      ],
    }).map(part)
    const batch = KiloCommandSubtasks.pending({
      user: user(parts).info as MessageV2.User,
      messages: [
        user(parts),
        {
          info: {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID,
            parentID: messageID,
            mode: "review-gpt",
            agent: "review-gpt",
            path: { cwd: "/tmp", root: "/tmp" },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: ModelID.make("gpt"),
            providerID: ProviderID.make("test"),
            time: { created: Date.now(), completed: Date.now() },
            finish: "tool-calls",
          },
          parts: [tool(parts[0])],
        },
      ],
    })

    expect(batch?.command).toBe("multi-review")
    expect(batch?.tasks).toHaveLength(1)
    expect(batch?.tasks[0].description).toBe("opus")
  })
})
