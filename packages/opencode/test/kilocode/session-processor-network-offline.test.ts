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
import { MessageID } from "../../src/session/schema"
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

describe("session processor network offline", () => {
  test("enters offline state for provider connection message", async () => {
    const { Bus } = await import("../../src/bus")
    const { Instance } = await import("../../src/project/instance")
    const { LLM } = await import("../../src/session/llm")
    const { Identifier } = await import("../../src/id/id")
    const { SessionNetwork } = await import("../../src/session/network")
    const { SessionStatus } = await import("../../src/session/status")
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
          id: MessageID.make(Identifier.ascending("message")),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "code",
          model: { providerID: m.providerID, modelID: m.id },
          tools: {},
        })) as MessageV2.User
        const assistant = (await Session.updateMessage({
          id: MessageID.make(Identifier.ascending("message")),
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

        const err = new Error("Unable to connect. Is the computer able to access the url?")
        const status: Array<unknown> = []
        const off = Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID !== session.id) return
          status.push(event.properties.status)
        })
        const offAsk = Bus.subscribe(SessionNetwork.Event.Asked, (event) => {
          if (event.properties.sessionID !== session.id) return
          void SessionNetwork.reply({ requestID: event.properties.id })
        })
        const ask = spyOn(SessionNetwork, "ask")
        const llm = spyOn(LLM, "stream")
          .mockRejectedValueOnce(err)
          .mockResolvedValueOnce({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "start-step" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 10, completionTokens: 5, totalTokens: 15 },
                providerMetadata: undefined,
              }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

        const processor = await SessionProcessor.create({
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
          expect(result).toBe("continue")
          expect(ask).toHaveBeenCalledTimes(1)
          expect(status).toContainEqual({
            type: "offline",
            requestID: expect.any(String),
            message: err.message,
          })
        } finally {
          off()
          offAsk()
          llm.mockRestore()
          ask.mockRestore()
        }
      },
    })
  })
})
