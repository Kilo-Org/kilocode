import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { BackgroundSubagentStart } from "../../src/kilocode/background-subagent-start"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskRuntime } from "../../src/kilocode/background-task-runtime"
import { SubagentSpawn } from "../../src/kilocode/subagent-spawn"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const spawnModule = SubagentSpawn as unknown as {
  prepare: typeof SubagentSpawn.prepare
}

const runtimeModule = BackgroundTaskRuntime as unknown as {
  start: typeof BackgroundTaskRuntime.start
}

const promptModule = SessionPrompt as unknown as {
  resolvePromptParts: typeof SessionPrompt.resolvePromptParts
  prompt: typeof SessionPrompt.prompt
}

type ResolveMock = typeof SessionPrompt.resolvePromptParts
type PromptMock = typeof SessionPrompt.prompt
type Parts = Awaited<ReturnType<ResolveMock>>
type PromptInput = Parameters<PromptMock>[0]
type PromptResult = Awaited<ReturnType<PromptMock>>
type RuntimeInput = Parameters<typeof BackgroundTaskRuntime.start>[0]
type RuntimeResult = Awaited<ReturnType<typeof BackgroundTaskRuntime.start>>

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

function prepared(): SubagentSpawn.Prepared {
  const launch = () => {}
  const completion = Promise.resolve({ resultMessageID: mid() })
  return {
    childSessionID: sid(),
    childUserMessageID: mid(),
    launch,
    completion,
  }
}

function runtimeResult(info: Partial<BackgroundTask.Info> = {}): RuntimeResult {
  const taskID = info.taskID ?? "bg_test"
  const generation = info.generation ?? 1
  return {
    info: {
      taskID,
      parentSessionID: info.parentSessionID ?? sid(),
      childSessionID: info.childSessionID ?? sid(),
      childUserMessageID: info.childUserMessageID ?? mid(),
      generation,
      status: info.status ?? "running",
      createdAt: info.createdAt ?? 1,
      startedAt: info.startedAt ?? 2,
      completedAt: info.completedAt,
      resultMessageID: info.resultMessageID,
      error: info.error,
    },
    claim: {
      taskID,
      generation,
      ownerToken: Symbol(taskID),
    },
  }
}

function withInstance(directory: string, fn: () => Promise<void>) {
  return Instance.provide({ directory, fn })
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

async function withPrompt<T>(
  opts: {
    resolve?: ResolveMock
    prompt?: (input: PromptInput) => ReturnType<PromptMock>
  },
  fn: () => Promise<T>,
) {
  const originalResolve = SessionPrompt.resolvePromptParts
  const originalPrompt = SessionPrompt.prompt
  const resolve = opts.resolve ?? (async (_prompt: string) => mockParts())
  const prompt = opts.prompt ?? (async (_input: PromptInput) => result())
  promptModule.resolvePromptParts = resolve
  promptModule.prompt = createPromptMock(originalPrompt, prompt)
  try {
    return await fn()
  } finally {
    promptModule.resolvePromptParts = originalResolve
    promptModule.prompt = originalPrompt
  }
}

afterEach(async () => {
  BackgroundTask.resetForTests()
  BackgroundTaskRuntime.resetForTests()
  await Instance.disposeAll()
})

describe("BackgroundSubagentStart", () => {
  test("passes the exact input to prepare, waits for it, passes exact prepared fields to runtime, and returns the exact runtime result", async () => {
    const input = makeInput()
    const prep = prepared()
    const gate = defer<SubagentSpawn.Prepared>()
    const out = runtimeResult({
      parentSessionID: input.parentSessionID,
      childSessionID: prep.childSessionID,
      childUserMessageID: prep.childUserMessageID,
    })
    const seen = {
      input: undefined as SubagentSpawn.Input | undefined,
      prepare: 0,
      runtime: 0,
    }
    const originalPrepare = SubagentSpawn.prepare
    const originalStart = BackgroundTaskRuntime.start
    let args: RuntimeInput | undefined

    spawnModule.prepare = async (next) => {
      seen.input = next
      seen.prepare++
      return gate.promise
    }
    runtimeModule.start = async (next) => {
      args = next
      seen.runtime++
      return out
    }

    try {
      const p = BackgroundSubagentStart.start(input)

      await Promise.resolve()
      expect(seen.input).toBe(input)
      expect(seen.prepare).toBe(1)
      expect(seen.runtime).toBe(0)

      gate.resolve(prep)

      const got = await p
      expect(seen.runtime).toBe(1)
      expect(args?.parentSessionID).toBe(input.parentSessionID)
      expect(args?.childSessionID).toBe(prep.childSessionID)
      expect(args?.childUserMessageID).toBe(prep.childUserMessageID)
      expect(args?.launch).toBe(prep.launch)
      expect(args?.completion).toBe(prep.completion)
      expect(got).toBe(out)
    } finally {
      spawnModule.prepare = originalPrepare
      runtimeModule.start = originalStart
    }
  })

  test("prepare rejection rejects with the exact error and never calls runtime", async () => {
    const input = makeInput()
    const err = new Error("prepare failed")
    const seen = {
      prepare: 0,
      runtime: 0,
    }
    const originalPrepare = SubagentSpawn.prepare
    const originalStart = BackgroundTaskRuntime.start

    spawnModule.prepare = async (_next) => {
      seen.prepare++
      throw err
    }
    runtimeModule.start = async (_next) => {
      seen.runtime++
      return runtimeResult()
    }

    try {
      await expect(BackgroundSubagentStart.start(input)).rejects.toBe(err)
      expect(seen.prepare).toBe(1)
      expect(seen.runtime).toBe(0)
    } finally {
      spawnModule.prepare = originalPrepare
      runtimeModule.start = originalStart
    }
  })

  test("runtime rejection rejects with the exact error after exactly one prepare call", async () => {
    const input = makeInput()
    const prep = prepared()
    const err = new Error("runtime failed")
    const seen = {
      prepare: 0,
      runtime: 0,
    }
    const originalPrepare = SubagentSpawn.prepare
    const originalStart = BackgroundTaskRuntime.start

    spawnModule.prepare = async (_next) => {
      seen.prepare++
      return prep
    }
    runtimeModule.start = async (_next) => {
      seen.runtime++
      throw err
    }

    try {
      await expect(BackgroundSubagentStart.start(input)).rejects.toBe(err)
      expect(seen.prepare).toBe(1)
      expect(seen.runtime).toBe(1)
    } finally {
      spawnModule.prepare = originalPrepare
      runtimeModule.start = originalStart
    }
  })
  test("successful startup creates one child session and later completes with the exact resultMessageID", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const { parent, input } = await seed()
      const gate = defer<PromptResult>()
      const done = mid()
      const seen = { prompt: 0 }

      await withPrompt(
        {
          resolve: async (_prompt) => mockParts(),
          prompt: async (next) => {
            seen.prompt++
            await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
            return gate.promise
          },
        },
        async () => {
          expect(await Session.children(parent.id)).toHaveLength(0)

          const out = await BackgroundSubagentStart.start(input)
          expect(out.info.status).toBe("running")
          expect(out.info.parentSessionID).toBe(parent.id)
          expect(out.info.childSessionID).toBeDefined()
          expect(out.info.childUserMessageID).toBeDefined()
          expect(out.info.taskID).toBeDefined()
          expect(out.info.taskID).not.toBe(out.info.childSessionID)
          expect(out.claim.taskID).toBe(out.info.taskID)
          expect(out.claim.generation).toBe(out.info.generation)
          expect(seen.prompt).toBe(1)

          const kids = await Session.children(parent.id)
          expect(kids).toHaveLength(1)
          expect(kids[0]?.id).toBe(out.info.childSessionID)
          expect(BackgroundTask.get(out.info.taskID)?.taskID).toBe(out.info.taskID)

          gate.resolve(result(done))
          await Bun.sleep(20)

          const info = BackgroundTask.get(out.info.taskID)
          expect(info?.status).toBe("completed")
          expect(info?.resultMessageID).toBe(done)
        },
      )
    })
  })

  test("TurnOpen followed by prompt rejection returns running first and later fails the registry task", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const { input } = await seed()
      const gate = defer<PromptResult>()
      const err = new Error("prompt failed")

      await withPrompt(
        {
          resolve: async (_prompt) => mockParts(),
          prompt: async (next) => {
            await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
            return gate.promise
          },
        },
        async () => {
          const out = await BackgroundSubagentStart.start(input)
          expect(out.info.status).toBe("running")

          gate.reject(err)
          await Bun.sleep(20)

          const info = BackgroundTask.get(out.info.taskID)
          expect(info?.status).toBe("failed")
          expect(info?.error?.message).toBe("prompt failed")
        },
      )
    })
  })

  test("resolvePromptParts rejection before TurnOpen rejects with the exact error and leaves one failed task plus the created child session", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const { parent, input } = await seed()
      const err = new Error("resolve failed")
      const seen = { prompt: 0 }

      await withPrompt(
        {
          resolve: async (_prompt) => {
            throw err
          },
          prompt: async (_next) => {
            seen.prompt++
            return result()
          },
        },
        async () => {
          await expect(BackgroundSubagentStart.start(input)).rejects.toBe(err)
          expect(seen.prompt).toBe(0)

          const tasks = BackgroundTask.list({ parentSessionID: parent.id })
          expect(tasks).toHaveLength(1)
          expect(tasks[0]?.status).toBe("failed")
          expect(tasks[0]?.startedAt).toBeUndefined()

          const kids = await Session.children(parent.id)
          expect(kids).toHaveLength(1)
          const child = await Session.get(kids[0]!.id)
          expect(child.id).toBe(kids[0]!.id)
          expect(tasks[0]?.childSessionID).toBe(child.id)
        },
      )
    })
  })

  test("synchronous SessionPrompt.prompt throw before TurnOpen rejects with the exact error, fails the registry task, and keeps the child session", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const { parent, input } = await seed()
      const err = new Error("prompt sync throw")

      await withPrompt(
        {
          resolve: async (_prompt) => mockParts(),
          prompt: (_next) => {
            throw err
          },
        },
        async () => {
          await expect(BackgroundSubagentStart.start(input)).rejects.toBe(err)

          const tasks = BackgroundTask.list({ parentSessionID: parent.id })
          expect(tasks).toHaveLength(1)
          expect(tasks[0]?.status).toBe("failed")
          expect(tasks[0]?.startedAt).toBeUndefined()

          const kids = await Session.children(parent.id)
          expect(kids).toHaveLength(1)
          const child = await Session.get(kids[0]!.id)
          expect(child.id).toBe(kids[0]!.id)
        },
      )
    })
  })
  test("successful completion before TurnOpen keeps startup pending and queued until the exact child TurnOpen arrives", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const { parent, input } = await seed()
      const done = mid()

      await withPrompt(
        {
          resolve: async (_prompt) => mockParts(),
          prompt: async (_next) => result(done),
        },
        async () => {
          const p = BackgroundSubagentStart.start(input)
          const state = await Promise.race([
            p.then(() => "resolved" as const),
            Bun.sleep(50).then(() => "pending" as const),
          ])

          expect(state).toBe("pending")

          const kids = await Session.children(parent.id)
          expect(kids).toHaveLength(1)

          const tasks = BackgroundTask.list({ parentSessionID: parent.id })
          expect(tasks).toHaveLength(1)
          expect(tasks[0]?.status).toBe("queued")
          expect(tasks[0]?.resultMessageID).toBeUndefined()

          await Bus.publish(Session.Event.TurnOpen, { sessionID: kids[0]!.id })

          const out = await p
          expect(out.info.status).toBe("running")

          await Bun.sleep(20)

          const info = BackgroundTask.get(out.info.taskID)
          expect(info?.status).toBe("completed")
          expect(info?.resultMessageID).toBe(done)
        },
      )
    })
  })

  test("prepare failure from Session.create poison permission rejects exactly and leaves the registry empty", async () => {
    await using tmp = await tmpdir()
    await withInstance(tmp.path, async () => {
      const parent = await createParent()
      const err = new Error("session create failed")
      const rule = {
        get permission(): string {
          throw err
        },
        pattern: "*",
        action: "deny",
      } as unknown as Permission.Rule
      const permission = [rule] as Permission.Ruleset

      await expect(
        BackgroundSubagentStart.start(
          makeInput({
            parentSessionID: parent.id,
            permission,
          }),
        ),
      ).rejects.toBe(err)

      expect(BackgroundTask.list({ parentSessionID: parent.id })).toHaveLength(0)
    })
  })

  test("production source stays a minimal composition adapter", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/background-subagent-start.ts", import.meta.url), "utf-8")

    expect(content).toContain("SubagentSpawn.prepare")
    expect(content).toContain("BackgroundTaskRuntime.start")
    expect(content).not.toContain("BackgroundTask.create")
    expect(content).not.toContain("BackgroundTask.transition")
    expect(content).not.toContain("BackgroundTaskCompletion")
    expect(content).not.toContain("BackgroundTaskCancel")
    expect(content).not.toContain("BackgroundTaskSessionCancel")
    expect(content).not.toContain("Session.create")
    expect(content).not.toContain("SessionPrompt")
    expect(content).not.toContain("Bus")
    expect(content).not.toContain("Agent")
    expect(content).not.toContain("Config")
    expect(content).not.toContain("Permission.merge")
    expect(content).not.toContain("Tool.define")
    expect(content).not.toContain("background_task")
    expect(content).not.toContain("resultMessageID")
    expect(content).not.toContain("finalText")
    expect(content).not.toContain("cancel")
    expect(content).not.toContain("status")
    expect(content).not.toContain("try")
    expect(content).not.toContain("catch")
    expect(content).not.toContain("new Promise")
  })
})
