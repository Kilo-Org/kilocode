// Set env before any imports that transitively load flag.ts (e.g. LLM, SessionRetry).
// This MUST happen before static imports, but ES module imports are hoisted.
// So we set it here and use mock.module + dynamic imports for modules that
// transitively load flag.ts to ensure the env is captured at load time.
process.env.KILO_SESSION_RETRY_LIMIT = "2"

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"

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

// Modules that do NOT transitively import flag.ts can be statically imported.
import { APICallError } from "ai"
import type { Provider } from "../../src/provider/provider"
import type { LLM as LLMType } from "../../src/session/llm"
import type { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function createModel(): Provider.Model {
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

function retryable429() {
  return new APICallError({
    message: "429 status code (no body)",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "content-type": "application/json" },
    isRetryable: true,
  })
}

function sentinel() {
  return new Error("unexpected extra llm call")
}

afterEach(() => {
  delete process.env.KILO_SESSION_RETRY_LIMIT
})

describe("session processor retry limit", () => {
  test("stops after two retries with the normalized retryable error", async () => {
    // Dynamic imports so that flag.ts sees KILO_SESSION_RETRY_LIMIT="2" set above
    const { Bus } = await import("../../src/bus")
    const { Identifier } = await import("../../src/id/id")
    const { MessageID } = await import("../../src/session/schema")
    const { ProviderID } = await import("../../src/provider/schema")
    const { Instance } = await import("../../src/project/instance")
    const { LLM } = await import("../../src/session/llm")
    const { MessageV2 } = await import("../../src/session/message-v2")
    const { SessionRetry } = await import("../../src/session/retry")
    const { SessionStatus } = await import("../../src/session/status")

    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Session } = await import("../../src/session")
        const { SessionProcessor } = await import("../../src/session/processor")
        const model = createModel()
        const session = await Session.create({})
        const user = (await Session.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: session.id,
          time: { created: Date.now() },
          agent: "code",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
        })) as MessageV2.User
        const assistant = (await Session.updateMessage({
          id: MessageID.ascending(),
          parentID: user.id,
          role: "assistant",
          mode: "code",
          agent: "code",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
          sessionID: session.id,
        })) as MessageV2.Assistant

        const retry: number[] = []
        const errors: Array<MessageV2.Assistant["error"]> = []
        const unsubStatus = Bus.subscribe(SessionStatus.Event.Status, (event) => {
          if (event.properties.sessionID !== session.id) return
          if (event.properties.status.type !== "retry") return
          retry.push(event.properties.status.attempt)
        })
        const unsubError = Bus.subscribe(Session.Event.Error, (event) => {
          if (event.properties.sessionID !== session.id) return
          errors.push(event.properties.error)
        })
        const llm = spyOn(LLM, "stream")
          .mockRejectedValueOnce(retryable429())
          .mockRejectedValueOnce(retryable429())
          .mockRejectedValueOnce(retryable429())
          .mockRejectedValue(sentinel())
        const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)
        const processor = await SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: session.id,
          model,
          abort: AbortSignal.any([]),
        })

        const inp: LLMType.StreamInput = {
          user,
          sessionID: session.id,
          model,
          agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
          system: [],
          abort: AbortSignal.any([]),
          messages: [],
          tools: {},
        }

        try {
          const result = await processor.process(inp)
          const expected = MessageV2.fromError(retryable429(), { providerID: ProviderID.make("openai") })

          expect(result).toBe("stop")
          expect(llm).toHaveBeenCalledTimes(3)
          expect(delay).toHaveBeenCalled()
          expect(retry).toStrictEqual([1, 2])
          expect(processor.message.error).toStrictEqual(expected)
          expect(errors).toStrictEqual([expected])
        } finally {
          unsubStatus()
          unsubError()
          llm.mockRestore()
          delay.mockRestore()
        }
      },
    })
  })

  test("only positive integers enable the limit", async () => {
    const key = () => JSON.stringify({ time: Date.now(), rand: Math.random() })

    delete process.env.KILO_SESSION_RETRY_LIMIT
    expect((await import("../../src/flag/flag?" + key())).Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

    process.env.KILO_SESSION_RETRY_LIMIT = "0"
    expect((await import("../../src/flag/flag?" + key())).Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

    process.env.KILO_SESSION_RETRY_LIMIT = "-1"
    expect((await import("../../src/flag/flag?" + key())).Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

    process.env.KILO_SESSION_RETRY_LIMIT = "abc"
    expect((await import("../../src/flag/flag?" + key())).Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

    process.env.KILO_SESSION_RETRY_LIMIT = "2"
    expect((await import("../../src/flag/flag?" + key())).Flag.KILO_SESSION_RETRY_LIMIT).toBe(2)
  })

  test("does not change after import", async () => {
    delete process.env.KILO_SESSION_RETRY_LIMIT
    const id = JSON.stringify({ time: Date.now(), rand: Math.random() })
    const { Flag: loaded } = await import("../../src/flag/flag?" + id)
    expect(loaded.KILO_SESSION_RETRY_LIMIT).toBeUndefined()
    process.env.KILO_SESSION_RETRY_LIMIT = "5"
    expect(loaded.KILO_SESSION_RETRY_LIMIT).toBeUndefined()
  })
})
