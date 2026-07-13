import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { SubagentSpawn } from "../../src/kilocode/subagent-spawn"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const promptModule = SessionPrompt as unknown as {
  resolvePromptParts: typeof SessionPrompt.resolvePromptParts
  prompt: typeof SessionPrompt.prompt
}

type ResolveMock = typeof SessionPrompt.resolvePromptParts
type PromptMock = typeof SessionPrompt.prompt
type Parts = Awaited<ReturnType<ResolveMock>>
type PromptInput = Parameters<PromptMock>[0]
type PromptResult = Awaited<ReturnType<PromptMock>>

function createPromptMock(originalPrompt: PromptMock, fn: (input: PromptInput) => ReturnType<PromptMock>): PromptMock {
  return Object.assign((input: PromptInput) => fn(input), {
    force: (input: PromptInput) => fn(input),
    schema: originalPrompt.schema,
  })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

function result(id = mid()): PromptResult {
  return {
    info: { id },
    parts: [],
  } as unknown as MessageV2.WithParts
}

function mockParts(text = "resolved"): Parts {
  return [{ type: "text", text }]
}

function makeInput(overrides: Partial<SubagentSpawn.Input> = {}): SubagentSpawn.Input {
  return {
    parentSessionID: sid(),
    title: "test-title",
    permission: [],
    prompt: "test prompt",
    model: {
      modelID: ModelID.make("test-model"),
      providerID: ProviderID.make("test-provider"),
    },
    agent: "general",
    tools: {},
    ...overrides,
  }
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function createParent(title = "parent") {
  return Session.create({ title })
}

async function seed(overrides: Partial<SubagentSpawn.Input> = {}) {
  const parent = await createParent()
  return {
    parent,
    input: makeInput({ parentSessionID: parent.id, ...overrides }),
  }
}

async function settle(prepared: SubagentSpawn.Prepared) {
  const originalResolvePromptParts = SessionPrompt.resolvePromptParts
  const originalPrompt = SessionPrompt.prompt
  const resolveMock: ResolveMock = async (_prompt) => mockParts()
  const promptMock = createPromptMock(originalPrompt, async (_input) => result())
  promptModule.resolvePromptParts = resolveMock
  promptModule.prompt = promptMock
  try {
    prepared.launch()
    await prepared.completion
  } finally {
    promptModule.resolvePromptParts = originalResolvePromptParts
    promptModule.prompt = originalPrompt
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("SubagentSpawn", () => {
  test("prepare creates exactly one fresh child session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, input } = await seed()
        expect(await Session.children(parent.id)).toHaveLength(0)

        const prepared = await SubagentSpawn.prepare(input)
        const children = await Session.children(parent.id)

        expect(children).toHaveLength(1)
        expect(children[0]?.id).toBe(prepared.childSessionID)
        expect(children[0]?.id).not.toBe(parent.id)

        await settle(prepared)
      },
    })
  })

  test("created session has the exact parentSessionID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, input } = await seed()
        const prepared = await SubagentSpawn.prepare(input)
        const child = await Session.get(prepared.childSessionID)

        expect(child.parentID).toBe(parent.id)

        await settle(prepared)
      },
    })
  })

  test("created session has the exact title", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed({ title: "my-exact-title" })
        const prepared = await SubagentSpawn.prepare(input)
        const child = await Session.get(prepared.childSessionID)

        expect(child.title).toBe("my-exact-title")

        await settle(prepared)
      },
    })
  })

  test("created session contains the exact supplied permission rules", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const permission: Permission.Ruleset = [
          { permission: "edit", pattern: "*.ts", action: "allow" },
          { permission: "bash", pattern: "*", action: "deny" },
        ]
        const { input } = await seed({ permission })
        const prepared = await SubagentSpawn.prepare(input)
        const child = await Session.get(prepared.childSessionID)

        expect(child.permission).toEqual(permission)

        await settle(prepared)
      },
    })
  })

  test("prepare returns the exact created childSessionID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent, input } = await seed()
        const prepared = await SubagentSpawn.prepare(input)
        const children = await Session.children(parent.id)

        expect(children).toHaveLength(1)
        expect(prepared.childSessionID).toBe(children[0]?.id)

        await settle(prepared)
      },
    })
  })

  test("prepare generates and returns one childUserMessageID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        let capturedMessageID: MessageID | undefined

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (prompt) => {
          capturedMessageID = prompt.messageID
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)

          expect(prepared.childUserMessageID).toBeDefined()

          prepared.launch()
          await prepared.completion

          expect(capturedMessageID).toBe(prepared.childUserMessageID)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("resolvePromptParts is not called during prepare", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        let resolveCalls = 0

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => {
          resolveCalls++
          return mockParts()
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => result())
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)

          expect(resolveCalls).toBe(0)

          prepared.launch()
          await prepared.completion

          expect(resolveCalls).toBe(1)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("SessionPrompt.prompt is not called during prepare", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        let promptCalls = 0

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          promptCalls++
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)

          expect(promptCalls).toBe(0)

          prepared.launch()
          await prepared.completion

          expect(promptCalls).toBe(1)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("completion remains pending before launch", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const gate = defer<PromptResult>()

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => gate.promise)
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          let settled = false
          prepared.completion.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          )

          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(settled).toBe(false)

          prepared.launch()

          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(settled).toBe(false)

          gate.resolve(result())
          await prepared.completion

          expect(settled).toBe(true)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("launch calls resolvePromptParts with the exact prompt string", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed({ prompt: "exact-prompt-string" })
        let capturedPrompt: string | undefined

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (prompt) => {
          capturedPrompt = prompt
          return mockParts()
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => result())
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          await prepared.completion

          expect(capturedPrompt).toBe("exact-prompt-string")
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("SessionPrompt.prompt receives the exact childSessionID, childUserMessageID, modelID, providerID, agent, tools, and parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parts = mockParts("resolved-content")
        const { input } = await seed({
          agent: "explore",
          tools: { read: true, edit: false },
          model: {
            modelID: ModelID.make("claude-3"),
            providerID: ProviderID.make("anthropic"),
          },
        })
        let capturedInput: PromptInput | undefined

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => parts
        const promptMock = createPromptMock(originalPrompt, async (prompt) => {
          capturedInput = prompt
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          await prepared.completion

          expect(capturedInput?.sessionID).toBe(prepared.childSessionID)
          expect(capturedInput?.messageID).toBe(prepared.childUserMessageID)
          expect(capturedInput?.model?.modelID).toBe(input.model.modelID)
          expect(capturedInput?.model?.providerID).toBe(input.model.providerID)
          expect(capturedInput?.agent).toBe(input.agent)
          expect(capturedInput?.tools).toEqual(input.tools)
          expect(capturedInput?.parts).toBe(parts)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("launch returns without waiting for a pending prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const gate = defer<PromptResult>()

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => gate.promise)
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          let settled = false
          prepared.completion.then(
            () => {
              settled = true
            },
            () => {
              settled = true
            },
          )

          expect(prepared.launch()).toBeUndefined()

          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(settled).toBe(false)

          gate.resolve(result())
          await prepared.completion

          expect(settled).toBe(true)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("launch invokes the prompt sequence exactly once", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        let resolveCalls = 0
        let promptCalls = 0

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => {
          resolveCalls++
          return mockParts()
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          promptCalls++
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          await prepared.completion

          expect(resolveCalls).toBe(1)
          expect(promptCalls).toBe(1)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("A second launch throws synchronously with exactly: Background subagent launch already started", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const gate = defer<PromptResult>()

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => gate.promise)
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()

          expect(() => prepared.launch()).toThrow("Background subagent launch already started")

          gate.resolve(result())
          await prepared.completion
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("A second launch does not call resolvePromptParts or prompt again", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const gate = defer<PromptResult>()
        let resolveCalls = 0
        let promptCalls = 0

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => {
          resolveCalls++
          return mockParts()
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          promptCalls++
          return gate.promise
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          await Promise.resolve()
          await Promise.resolve()

          expect(() => prepared.launch()).toThrow("Background subagent launch already started")
          expect(resolveCalls).toBe(1)
          expect(promptCalls).toBe(1)

          gate.resolve(result())
          await prepared.completion
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("Successful prompt completion resolves completion with the exact assistant message.info.id", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const resultMessageID = mid()

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => result(resultMessageID))
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          const output = await prepared.completion

          expect(output.resultMessageID).toBe(resultMessageID)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("Successful completion exposes only resultMessageID and does not expose the full message or parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          return {
            info: { id: mid() },
            parts: [{ type: "text", text: "secret-content" }],
          } as unknown as MessageV2.WithParts
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()
          const output = await prepared.completion

          expect(Object.keys(output)).toEqual(["resultMessageID"])
          expect((output as { info?: unknown }).info).toBeUndefined()
          expect((output as { parts?: unknown }).parts).toBeUndefined()
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("resolvePromptParts rejection rejects completion with the exact error object and never calls SessionPrompt.prompt", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const error = new Error("resolve failed")
        let promptCalls = 0

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => {
          throw error
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          promptCalls++
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()

          let rejected: unknown
          try {
            await prepared.completion
          } catch (cause) {
            rejected = cause
          }

          expect(rejected).toBe(error)
          expect(promptCalls).toBe(0)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("synchronous SessionPrompt.prompt throw rejects completion with the exact error object", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const error = new Error("prompt sync throw")

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, (_input) => {
          throw error
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()

          let rejected: unknown
          try {
            await prepared.completion
          } catch (cause) {
            rejected = cause
          }

          expect(rejected).toBe(error)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("asynchronous SessionPrompt.prompt rejection rejects completion with the exact error object", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const error = new Error("prompt async reject")

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          await Promise.resolve()
          throw error
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()

          let rejected: unknown
          try {
            await prepared.completion
          } catch (cause) {
            rejected = cause
          }

          expect(rejected).toBe(error)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("Session.create failure rejects prepare with the exact error", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { parent } = await seed()
        const error = new Error("session create failed")
        const poisonRule = {
          get permission(): string {
            throw error
          },
          pattern: "*",
          action: "deny",
        } as unknown as Permission.Rule
        const permission = [poisonRule] as Permission.Ruleset
        let resolveCalled = false
        let promptCalled = false

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => {
          resolveCalled = true
          return mockParts()
        }
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          promptCalled = true
          return result()
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          let rejected: unknown
          try {
            await SubagentSpawn.prepare(
              makeInput({
                parentSessionID: parent.id,
                permission,
              }),
            )
          } catch (cause) {
            rejected = cause
          }

          expect(rejected).toBe(error)
          expect(resolveCalled).toBe(false)
          expect(promptCalled).toBe(false)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("A prompt failure does not delete the already-created child session", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { input } = await seed()
        const error = new Error("prompt failed")

        const originalResolvePromptParts = SessionPrompt.resolvePromptParts
        const originalPrompt = SessionPrompt.prompt
        const resolveMock: ResolveMock = async (_prompt) => mockParts()
        const promptMock = createPromptMock(originalPrompt, async (_input) => {
          throw error
        })
        promptModule.resolvePromptParts = resolveMock
        promptModule.prompt = promptMock

        try {
          const prepared = await SubagentSpawn.prepare(input)
          prepared.launch()

          try {
            await prepared.completion
          } catch {}

          const child = await Session.get(prepared.childSessionID)
          expect(child.id).toBe(prepared.childSessionID)
        } finally {
          promptModule.resolvePromptParts = originalResolvePromptParts
          promptModule.prompt = originalPrompt
        }
      },
    })
  })

  test("production source contains no forbidden behavior", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/subagent-spawn.ts", import.meta.url), "utf-8")

    expect(content).toContain("SubagentSpawn")
    expect(content).toContain("Session.create")
    expect(content).toContain("SessionPrompt.resolvePromptParts")
    expect(content).toContain("SessionPrompt.prompt")
    expect(content).not.toContain("BackgroundTask")
    expect(content).not.toContain("BackgroundTaskRuntime")
    expect(content).not.toContain("BackgroundTaskCancel")
    expect(content).not.toContain("SessionPrompt.cancel")
    expect(content).not.toContain("ForegroundTask")
    expect(content).not.toContain("Tool.define")
    expect(content).not.toContain("Agent.get")
    expect(content).not.toContain("Config.get")
    expect(content).not.toContain("transitionToCancelled")
    expect(content).not.toContain("background_task")
  })
})
