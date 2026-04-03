import { describe, expect, mock, spyOn, test } from "bun:test"

mock.module("@/kilo-sessions/remote-sender", () => ({
  RemoteSender: {
    create() {
      return {
        queue() {},
        flush: async () => undefined,
      }
    },
  },
}))

import type { Provider } from "../../src/provider/provider"
import type { LLM as LLMType } from "../../src/session/llm"
import type { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function model(): Provider.Model {
  return {
    id: "gpt-4",
    providerID: "openai",
    name: "GPT-4",
    limit: {
      context: 128000,
      input: 0,
      output: 4096,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { id: "openai", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    options: {},
    headers: {},
  } as Provider.Model
}

function stream(events: Array<Record<string, unknown>>): any {
  return {
    fullStream: (async function* () {
      for (const e of events) yield e
    })(),
  }
}

describe("session processor empty tool-calls", () => {
  test("converts finish to stop when model returns tool-calls with no tools", async () => {
    const { Instance } = await import("../../src/project/instance")
    const { LLM } = await import("../../src/session/llm")
    const { Identifier } = await import("../../src/id/id")
    const { MessageV2 } = await import("../../src/session/message-v2")

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Session } = await import("../../src/session")
        const { SessionProcessor } = await import("../../src/session/processor")
        const m = model()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "code",
          model: { providerID: m.providerID, modelID: m.id },
          tools: {},
        })) as MessageV2.User
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: user.id,
          role: "assistant",
          mode: "code",
          agent: "code",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: m.id,
          providerID: m.providerID,
          time: { created: Date.now() },
          sessionID: session.id,
        })) as MessageV2.Assistant

        // Stream with finish_reason "tool-calls" but zero tool events
        const llm = spyOn(LLM, "stream").mockResolvedValueOnce(
          stream([
            { type: "start" },
            { type: "start-step" },
            {
              type: "finish-step",
              finishReason: "tool-calls",
              usage: { inputTokens: 100, completionTokens: 41, totalTokens: 141 },
              providerMetadata: undefined,
            },
            { type: "finish" },
          ]),
        )

        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model: m,
          abort: AbortSignal.any([]),
        })
        const inp: LLMType.StreamInput = {
          user,
          sessionID: session.id,
          model: m,
          agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
          system: [],
          abort: AbortSignal.any([]),
          messages: [],
          tools: {},
        }

        try {
          const result = await processor.process(inp)
          // The processor must convert "tool-calls" → "stop" when no tools were emitted
          expect(processor.message.finish).toBe("stop")
          // Verify no tool parts exist on the message
          const parts = await MessageV2.parts(assistant.id)
          const tools = parts.filter((p: any) => p.type === "tool")
          expect(tools.length).toBe(0)
        } finally {
          llm.mockRestore()
        }
      },
    })
  })

  test("preserves tool-calls finish when tool parts exist", async () => {
    const { Instance } = await import("../../src/project/instance")
    const { LLM } = await import("../../src/session/llm")
    const { Identifier } = await import("../../src/id/id")
    const { MessageV2 } = await import("../../src/session/message-v2")

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Session } = await import("../../src/session")
        const { SessionProcessor } = await import("../../src/session/processor")
        const m = model()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "code",
          model: { providerID: m.providerID, modelID: m.id },
          tools: {},
        })) as MessageV2.User
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: user.id,
          role: "assistant",
          mode: "code",
          agent: "code",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: m.id,
          providerID: m.providerID,
          time: { created: Date.now() },
          sessionID: session.id,
        })) as MessageV2.Assistant

        // Stream with finish_reason "tool-calls" AND a tool-input-start event
        const llm = spyOn(LLM, "stream").mockResolvedValueOnce(
          stream([
            { type: "start" },
            { type: "start-step" },
            { type: "tool-input-start", id: "call_1", toolName: "test_tool" },
            {
              type: "finish-step",
              finishReason: "tool-calls",
              usage: { inputTokens: 100, completionTokens: 41, totalTokens: 141 },
              providerMetadata: undefined,
            },
            { type: "finish" },
          ]),
        )

        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model: m,
          abort: AbortSignal.any([]),
        })
        const inp: LLMType.StreamInput = {
          user,
          sessionID: session.id,
          model: m,
          agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
          system: [],
          abort: AbortSignal.any([]),
          messages: [],
          tools: {},
        }

        try {
          const result = await processor.process(inp)
          // finish must remain "tool-calls" because a tool part WAS created
          expect(processor.message.finish).toBe("tool-calls")
          expect(result).toBe("continue")
          // Verify the tool part exists
          const parts = await MessageV2.parts(assistant.id)
          const tools = parts.filter((p: any) => p.type === "tool")
          expect(tools.length).toBe(1)
        } finally {
          llm.mockRestore()
        }
      },
    })
  })
})
