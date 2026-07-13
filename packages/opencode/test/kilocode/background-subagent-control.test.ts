// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { BackgroundSubagentControl } from "../../src/kilocode/background-subagent-control"
import { BackgroundSubagentStart } from "../../src/kilocode/background-subagent-start"
import { BackgroundTask } from "../../src/kilocode/background-task"
import { BackgroundTaskRuntime } from "../../src/kilocode/background-task-runtime"
import { BackgroundTaskSessionCancel } from "../../src/kilocode/background-task-session-cancel"
import { SubagentSpawn } from "../../src/kilocode/subagent-spawn"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"

const startModule = BackgroundSubagentStart as unknown as {
  start: typeof BackgroundSubagentStart.start
}

const cancelModule = BackgroundTaskSessionCancel as unknown as {
  cancel: typeof BackgroundTaskSessionCancel.cancel
}

const messageModule = MessageV2 as unknown as {
  get: typeof MessageV2.get
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
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

function sid() {
  return SessionID.make(Identifier.ascending("session"))
}

function mid() {
  return MessageID.make(Identifier.ascending("message"))
}

function result(id = mid()): MessageV2.WithParts {
  return {
    info: { id },
    parts: [],
  } as unknown as MessageV2.WithParts
}

function makeInfo(overrides: Partial<BackgroundTask.Info> & { parentSessionID: SessionID }): BackgroundTask.Info {
  const taskID = overrides.taskID ?? "bg_test"
  return {
    taskID,
    parentSessionID: overrides.parentSessionID,
    childSessionID: overrides.childSessionID ?? sid(),
    childUserMessageID: overrides.childUserMessageID ?? mid(),
    generation: overrides.generation ?? 1,
    status: overrides.status ?? "queued",
    createdAt: overrides.createdAt ?? 1,
    startedAt: overrides.startedAt ?? undefined,
    completedAt: overrides.completedAt ?? undefined,
    resultMessageID: overrides.resultMessageID ?? undefined,
    error: overrides.error ?? undefined,
  }
}

function makeClaim(overrides: Partial<BackgroundTask.Claim> & { taskID: string }): BackgroundTask.Claim {
  return {
    taskID: overrides.taskID,
    generation: overrides.generation ?? 1,
    ownerToken: overrides.ownerToken ?? Symbol(overrides.taskID),
  }
}

afterEach(async () => {
  BackgroundSubagentControl.resetForTests()
  BackgroundTask.resetForTests()
  BackgroundTaskRuntime.resetForTests()
  await Instance.disposeAll()
})

describe("BackgroundSubagentControl", () => {
  describe("start", () => {
    test("passes the exact input object to BackgroundSubagentStart.start", async () => {
      const input = { title: "test" } as unknown as SubagentSpawn.Input
      const started = {
        info: makeInfo({ parentSessionID: sid(), taskID: "bg_t1" }),
        claim: makeClaim({ taskID: "bg_t1" }),
      }
      const original = BackgroundSubagentStart.start
      let seen: unknown

      startModule.start = async (next) => {
        seen = next
        return started
      }

      try {
        await BackgroundSubagentControl.start(input)
        expect(seen).toBe(input)
      } finally {
        startModule.start = original
      }
    })

    test("calls BackgroundSubagentStart.start exactly once", async () => {
      const input = { title: "test" } as unknown as SubagentSpawn.Input
      const started = {
        info: makeInfo({ parentSessionID: sid(), taskID: "bg_t2" }),
        claim: makeClaim({ taskID: "bg_t2" }),
      }
      const original = BackgroundSubagentStart.start
      let calls = 0

      startModule.start = async (_next) => {
        calls++
        return started
      }

      try {
        await BackgroundSubagentControl.start(input)
        expect(calls).toBe(1)
      } finally {
        startModule.start = original
      }
    })

    test("stores the exact claim and returns the exact info object by identity", async () => {
      const parentSessionID = sid()
      const info = makeInfo({ parentSessionID, taskID: "bg_t3" })
      const claim = makeClaim({ taskID: "bg_t3" })
      const started = { info, claim }
      const original = BackgroundSubagentStart.start

      startModule.start = async (_next) => started

      try {
        const result = await BackgroundSubagentControl.start({} as SubagentSpawn.Input)
        expect(result).toBe(info)
      } finally {
        startModule.start = original
      }
    })

    test("rejection preserves the exact error object", async () => {
      const err = new Error("startup failed")
      const original = BackgroundSubagentStart.start

      startModule.start = async (_next) => {
        throw err
      }

      try {
        await expect(BackgroundSubagentControl.start({} as SubagentSpawn.Input)).rejects.toBe(err)
      } finally {
        startModule.start = original
      }
    })

    test("rejection creates no claim-map ownership and no registry state", async () => {
      const err = new Error("no state")
      const original = BackgroundSubagentStart.start

      startModule.start = async (_next) => {
        throw err
      }

      try {
        await expect(BackgroundSubagentControl.start({} as SubagentSpawn.Input)).rejects.toBe(err)
        expect(BackgroundTask.list()).toHaveLength(0)
      } finally {
        startModule.start = original
      }
    })
  })

  describe("status", () => {
    test("returns current info from BackgroundTask registry", () => {
      const parentSessionID = sid()
      const childSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID,
        childUserMessageID: mid(),
      })
      const result = BackgroundSubagentControl.status({
        parentSessionID,
        taskID: created.info.taskID,
      })
      expect(result).toBeDefined()
      expect(result!.taskID).toBe(created.info.taskID)
      expect(result!.parentSessionID).toBe(parentSessionID)
      expect(result!.childSessionID).toBe(childSessionID)
      expect(result!.status).toBe("queued")
    })

    test("returns undefined for unknown taskID", () => {
      const result = BackgroundSubagentControl.status({
        parentSessionID: sid(),
        taskID: "nonexistent",
      })
      expect(result).toBeUndefined()
    })

    test("returns undefined for parent mismatch", () => {
      const parentA = sid()
      const parentB = sid()
      const created = BackgroundTask.create({
        parentSessionID: parentA,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      const result = BackgroundSubagentControl.status({
        parentSessionID: parentB,
        taskID: created.info.taskID,
      })
      expect(result).toBeUndefined()
    })

    test("does not return stale start info - reflects current registry state", () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      expect(BackgroundSubagentControl.status({ parentSessionID, taskID: created.info.taskID })!.status).toBe("queued")
      const running = BackgroundTask.transitionToRunning(created.claim)
      expect(running.applied).toBe(true)
      expect(BackgroundSubagentControl.status({ parentSessionID, taskID: created.info.taskID })!.status).toBe("running")
    })
  })

  describe("result", () => {
    test("returns current info with undefined message for queued task", () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      const r = BackgroundSubagentControl.result({
        parentSessionID,
        taskID: created.info.taskID,
      })
      // Sync result for non-completed tasks returns immediately
      expect(r).resolves.toEqual({
        info: expect.objectContaining({ taskID: created.info.taskID, status: "queued" }),
        message: undefined,
      })
    })

    test("returns current info with undefined message for running task", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      BackgroundTask.transitionToRunning(created.claim)
      const r = BackgroundSubagentControl.result({
        parentSessionID,
        taskID: created.info.taskID,
      })
      expect(r).resolves.toEqual({
        info: expect.objectContaining({ taskID: created.info.taskID, status: "running" }),
        message: undefined,
      })
    })

    test("returns current info with undefined message for failed task", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      BackgroundTask.transitionToFailed({ ...created.claim, error: new Error("fail") })
      const r = BackgroundSubagentControl.result({
        parentSessionID,
        taskID: created.info.taskID,
      })
      expect(r).resolves.toEqual({
        info: expect.objectContaining({ taskID: created.info.taskID, status: "failed" }),
        message: undefined,
      })
    })

    test("returns current info with undefined message for cancelled task", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      BackgroundTask.transitionToCancelled(created.claim)
      const r = BackgroundSubagentControl.result({
        parentSessionID,
        taskID: created.info.taskID,
      })
      expect(r).resolves.toEqual({
        info: expect.objectContaining({ taskID: created.info.taskID, status: "cancelled" }),
        message: undefined,
      })
    })

    test("queued, running, failed, and cancelled results never call MessageV2.get", async () => {
      const parentSessionID = sid()
      const originalGet = MessageV2.get
      let calls = 0

      messageModule.get = (async (_input) => {
        calls++
        return result()
      }) as typeof MessageV2.get

      try {
        const queued = BackgroundTask.create({
          parentSessionID,
          childSessionID: sid(),
          childUserMessageID: mid(),
          taskID: "bg_q",
        })
        const running = BackgroundTask.create({
          parentSessionID,
          childSessionID: sid(),
          childUserMessageID: mid(),
          taskID: "bg_r",
        })
        const failed = BackgroundTask.create({
          parentSessionID,
          childSessionID: sid(),
          childUserMessageID: mid(),
          taskID: "bg_f",
        })
        const cancelled = BackgroundTask.create({
          parentSessionID,
          childSessionID: sid(),
          childUserMessageID: mid(),
          taskID: "bg_c",
        })

        BackgroundTask.transitionToRunning(running.claim)
        BackgroundTask.transitionToFailed({ ...failed.claim, error: new Error("no message") })
        BackgroundTask.transitionToCancelled(cancelled.claim)

        expect(await BackgroundSubagentControl.result({ parentSessionID, taskID: queued.info.taskID })).toEqual({
          info: expect.objectContaining({ taskID: queued.info.taskID, status: "queued" }),
          message: undefined,
        })
        expect(await BackgroundSubagentControl.result({ parentSessionID, taskID: running.info.taskID })).toEqual({
          info: expect.objectContaining({ taskID: running.info.taskID, status: "running" }),
          message: undefined,
        })
        expect(await BackgroundSubagentControl.result({ parentSessionID, taskID: failed.info.taskID })).toEqual({
          info: expect.objectContaining({ taskID: failed.info.taskID, status: "failed" }),
          message: undefined,
        })
        expect(await BackgroundSubagentControl.result({ parentSessionID, taskID: cancelled.info.taskID })).toEqual({
          info: expect.objectContaining({ taskID: cancelled.info.taskID, status: "cancelled" }),
          message: undefined,
        })
        expect(calls).toBe(0)
      } finally {
        messageModule.get = originalGet
      }
    })

    test("returns undefined for unknown taskID", async () => {
      const r = await BackgroundSubagentControl.result({
        parentSessionID: sid(),
        taskID: "nonexistent",
      })
      expect(r).toBeUndefined()
    })

    test("returns undefined for parent mismatch", async () => {
      const parentA = sid()
      const parentB = sid()
      const created = BackgroundTask.create({
        parentSessionID: parentA,
        childSessionID: sid(),
        childUserMessageID: mid(),
      })
      const r = await BackgroundSubagentControl.result({
        parentSessionID: parentB,
        taskID: created.info.taskID,
      })
      expect(r).toBeUndefined()
    })

    test("completed task fetches message with exact childSessionID and resultMessageID, calls MessageV2.get exactly once, returns exact message by identity", async () => {
      const parentSessionID = sid()
      const childSessionID = sid()
      const resultMessageID = mid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID,
        childUserMessageID: mid(),
        taskID: "bg_result1",
      })
      BackgroundTask.transitionToRunning(created.claim)
      BackgroundTask.transitionToCompleted({ ...created.claim, resultMessageID })

      const fakeMessage = {
        info: { id: resultMessageID, sessionID: childSessionID, role: "user" } as unknown as MessageV2.Info,
        parts: [],
      } as MessageV2.WithParts

      const originalGet = MessageV2.get
      const seen = { args: [] as unknown[], calls: 0 }

      const getModule = MessageV2 as unknown as { get: typeof MessageV2.get }
      getModule.get = (async (input: { sessionID: SessionID; messageID: MessageID }) => {
        seen.calls++
        seen.args.push(input)
        return fakeMessage
      }) as typeof MessageV2.get

      try {
        const r = await BackgroundSubagentControl.result({
          parentSessionID,
          taskID: "bg_result1",
        })
        expect(r).toBeDefined()
        expect(r!.info.taskID).toBe("bg_result1")
        expect(r!.message).toBe(fakeMessage)
        expect(seen.calls).toBe(1)
        expect(seen.args[0]).toEqual({
          sessionID: childSessionID,
          messageID: resultMessageID,
        })
      } finally {
        getModule.get = originalGet
      }
    })

    test("completed task without resultMessageID throws exact message", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_nores",
      })
      BackgroundTask.transitionToRunning(created.claim)
      BackgroundTask.transitionToCompleted({ ...created.claim, resultMessageID: undefined! })

      await expect(
        BackgroundSubagentControl.result({
          parentSessionID,
          taskID: "bg_nores",
        }),
      ).rejects.toThrow("Background task completed without result message: bg_nores")
    })
  })

  describe("cancel", () => {
    test("uses exact claim returned by startup and calls BackgroundTaskSessionCancel.cancel exactly once", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_c1",
      })
      const started = { info: created.info, claim: created.claim }
      const originalStart = BackgroundSubagentStart.start

      startModule.start = async (_next) => started

      const originalCancel = BackgroundTaskSessionCancel.cancel
      const seen = { claim: undefined as BackgroundTask.Claim | undefined, calls: 0 }

      cancelModule.cancel = async (c) => {
        seen.calls++
        seen.claim = c
        return { applied: true, info: created.info }
      }

      try {
        await BackgroundSubagentControl.start({} as SubagentSpawn.Input)
        const r = await BackgroundSubagentControl.cancel({
          parentSessionID,
          taskID: "bg_c1",
        })
        expect(seen.calls).toBe(1)
        expect(seen.claim).toBe(created.claim)
        expect(r).toEqual({ applied: true, info: created.info })
      } finally {
        startModule.start = originalStart
        cancelModule.cancel = originalCancel
      }
    })

    test("returns exact transition result object by identity", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_c2",
      })
      const started = { info: created.info, claim: created.claim }
      const originalStart = BackgroundSubagentStart.start
      const transitionResult: BackgroundTask.TransitionResult = { applied: true, info: created.info }

      startModule.start = async (_next) => started

      const originalCancel = BackgroundTaskSessionCancel.cancel
      cancelModule.cancel = async (_c) => transitionResult

      try {
        await BackgroundSubagentControl.start({} as SubagentSpawn.Input)
        const r = await BackgroundSubagentControl.cancel({
          parentSessionID,
          taskID: "bg_c2",
        })
        expect(r).toBe(transitionResult)
      } finally {
        startModule.start = originalStart
        cancelModule.cancel = originalCancel
      }
    })

    test("returns undefined for unknown taskID and never invokes session cancellation", async () => {
      const originalCancel = BackgroundTaskSessionCancel.cancel
      let cancelCalled = false
      cancelModule.cancel = async (_c) => {
        cancelCalled = true
        return { applied: false, info: undefined }
      }

      try {
        const r = await BackgroundSubagentControl.cancel({
          parentSessionID: sid(),
          taskID: "nonexistent",
        })
        expect(r).toBeUndefined()
        expect(cancelCalled).toBe(false)
      } finally {
        cancelModule.cancel = originalCancel
      }
    })

    test("returns undefined for parent mismatch and never invokes session cancellation", async () => {
      const parentA = sid()
      const parentB = sid()
      const created = BackgroundTask.create({
        parentSessionID: parentA,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_parent_mismatch",
      })

      const originalCancel = BackgroundTaskSessionCancel.cancel
      let cancelCalled = false
      cancelModule.cancel = async (_c) => {
        cancelCalled = true
        return { applied: false, info: undefined }
      }

      try {
        const r = await BackgroundSubagentControl.cancel({
          parentSessionID: parentB,
          taskID: "bg_parent_mismatch",
        })
        expect(r).toBeUndefined()
        expect(cancelCalled).toBe(false)
      } finally {
        cancelModule.cancel = originalCancel
      }
    })

    test("existing parent-owned task without retained claim throws", async () => {
      const parentSessionID = sid()
      BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_noclaim",
      })

      await expect(
        BackgroundSubagentControl.cancel({
          parentSessionID,
          taskID: "bg_noclaim",
        }),
      ).rejects.toThrow("Background task claim unavailable: bg_noclaim")
    })

    test("repeated cancellation stays idempotent", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_idem",
      })
      const started = { info: created.info, claim: created.claim }
      const originalStart = BackgroundSubagentStart.start

      startModule.start = async (_next) => started

      let cancelCount = 0
      const originalCancel = BackgroundTaskSessionCancel.cancel
      cancelModule.cancel = async (_c) => {
        cancelCount++
        const t = BackgroundTask.transitionToCancelled(created.claim)
        return { applied: t.applied, info: t.info }
      }

      try {
        await BackgroundSubagentControl.start({} as SubagentSpawn.Input)
        const r1 = await BackgroundSubagentControl.cancel({ parentSessionID, taskID: "bg_idem" })
        expect(r1!.applied).toBe(true)
        const r2 = await BackgroundSubagentControl.cancel({ parentSessionID, taskID: "bg_idem" })
        expect(r2!.applied).toBe(false)
        expect(cancelCount).toBe(2)
        expect(BackgroundTask.get("bg_idem")!.status).toBe("cancelled")
      } finally {
        startModule.start = originalStart
        cancelModule.cancel = originalCancel
      }
    })
  })

  describe("resetForTests", () => {
    test("removes retained claims but does not alter BackgroundTask registry entries", async () => {
      const parentSessionID = sid()
      const created = BackgroundTask.create({
        parentSessionID,
        childSessionID: sid(),
        childUserMessageID: mid(),
        taskID: "bg_reset",
      })
      const started = { info: created.info, claim: created.claim }
      const originalStart = BackgroundSubagentStart.start

      startModule.start = async (_next) => started

      try {
        await BackgroundSubagentControl.start({} as SubagentSpawn.Input)
        expect(BackgroundTask.get("bg_reset")).toBeDefined()
        expect(BackgroundTask.get("bg_reset")!.status).toBe("queued")

        BackgroundSubagentControl.resetForTests()

        expect(BackgroundTask.get("bg_reset")).toBeDefined()

        BackgroundTask.transitionToRunning(created.claim)
        expect(BackgroundTask.get("bg_reset")!.status).toBe("running")
      } finally {
        startModule.start = originalStart
      }
    })
  })

  describe("integration", () => {
    type PromptFunc = typeof SessionPrompt.prompt

    function createPromptMock(fn: (input: Parameters<PromptFunc>[0]) => ReturnType<PromptFunc>): PromptFunc {
      const originalPrompt = SessionPrompt.prompt
      return Object.assign((input: Parameters<PromptFunc>[0]) => fn(input), {
        force: (input: Parameters<PromptFunc>[0]) => fn(input),
        schema: originalPrompt.schema,
      }) as unknown as PromptFunc
    }

    async function withPrompt<T>(
      opts: {
        resolve?: typeof SessionPrompt.resolvePromptParts
        prompt?: (input: Parameters<PromptFunc>[0]) => ReturnType<PromptFunc>
      },
      fn: () => Promise<T>,
    ) {
      const promptModule = SessionPrompt as unknown as {
        resolvePromptParts: typeof SessionPrompt.resolvePromptParts
        prompt: PromptFunc
      }
      const originalResolve = promptModule.resolvePromptParts
      const originalPrompt = promptModule.prompt
      const resolve = opts.resolve ?? (async (_prompt: string) => [{ type: "text" as const, text: "resolved" }])
      const prompt = opts.prompt
        ? createPromptMock(opts.prompt)
        : createPromptMock(
            async (_input: Parameters<PromptFunc>[0]) =>
              ({ info: { id: mid() }, parts: [] }) as unknown as MessageV2.WithParts,
          )

      promptModule.resolvePromptParts = resolve
      promptModule.prompt = prompt
      try {
        return await fn()
      } finally {
        promptModule.resolvePromptParts = originalResolve
        promptModule.prompt = originalPrompt
      }
    }

    function makeInput(overrides: Partial<SubagentSpawn.Input> & { parentSessionID: SessionID }): SubagentSpawn.Input {
      return {
        parentSessionID: overrides.parentSessionID,
        title: "integration-test",
        permission: [],
        prompt: "test prompt",
        model: { modelID: ModelID.make("test-model"), providerID: ProviderID.make("test-provider") },
        agent: "general",
        tools: {},
      }
    }

    test("control start returns running BackgroundTask.Info with a stable taskID", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect(info.status).toBe("running")
              expect(info.parentSessionID).toBe(parent.id)
              expect(info.taskID).toBeDefined()
              expect(info.taskID).not.toBe(info.childSessionID)

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
            },
          )
        },
      })
    })

    test("returned value does not contain claim or ownerToken properties", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent2" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect("claim" in info).toBe(false)
              expect("ownerToken" in info).toBe(false)

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
            },
          )
        },
      })
    })

    test("status returns the running task for the correct parent", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent3" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              const s = BackgroundSubagentControl.status({ parentSessionID: parent.id, taskID: info.taskID })
              expect(s).toBeDefined()
              expect(s!.taskID).toBe(info.taskID)
              expect(s!.status).toBe("running")
              expect(s!.parentSessionID).toBe(parent.id)

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
            },
          )
        },
      })
    })

    test("status returns undefined for a different parent", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent4" })
          const other = sid()
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              const s = BackgroundSubagentControl.status({ parentSessionID: other, taskID: info.taskID })
              expect(s).toBeUndefined()

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
            },
          )
        },
      })
    })

    test("successful completion updates status to completed", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent5" })
          const done = mid()
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect(info.status).toBe("running")

              gate.resolve({ info: { id: done }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)

              const s = BackgroundSubagentControl.status({ parentSessionID: parent.id, taskID: info.taskID })
              expect(s!.status).toBe("completed")
              expect(s!.resultMessageID).toBe(done)
            },
          )
        },
      })
    })

    test("cancellation of a running task transitions to cancelled, targets child session, leaves parent intact, returns applied true first time", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent6" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect(info.status).toBe("running")

              const childSessions = await Session.children(parent.id)
              expect(childSessions).toHaveLength(1)
              const childID = childSessions[0]!.id
              expect(childID).toBe(info.childSessionID)

              const r = await BackgroundSubagentControl.cancel({ parentSessionID: parent.id, taskID: info.taskID })
              expect(r!.applied).toBe(true)
              expect(r!.info!.status).toBe("cancelled")
              expect(BackgroundTask.get(info.taskID)!.status).toBe("cancelled")

              const parentStillExists = await Session.get(parent.id)
              expect(parentStillExists.id).toBe(parent.id)

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
              expect(BackgroundTask.get(info.taskID)!.status).toBe("cancelled")
            },
          )
        },
      })
    })

    test("repeated cancellation returns applied false and preserves terminal state", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent7" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect(info.status).toBe("running")

              const r1 = await BackgroundSubagentControl.cancel({ parentSessionID: parent.id, taskID: info.taskID })
              expect(r1!.applied).toBe(true)

              const r2 = await BackgroundSubagentControl.cancel({ parentSessionID: parent.id, taskID: info.taskID })
              expect(r2!.applied).toBe(false)
              expect(r2!.info!.status).toBe("cancelled")

              await Bun.sleep(20)
              const s = BackgroundTask.get(info.taskID)
              expect(s!.status).toBe("cancelled")

              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
              expect(BackgroundTask.get(info.taskID)!.status).toBe("cancelled")
            },
          )
        },
      })
    })

    test("failed task result returns failed info with no message lookup", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent8" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              expect(info.status).toBe("running")

              const originalGet = MessageV2.get
              let calls = 0
              messageModule.get = (async (_input) => {
                calls++
                return result()
              }) as typeof MessageV2.get

              try {
                gate.reject(new Error("prompt failed"))
                await gate.promise.catch(() => undefined)
                await Bun.sleep(20)

                const r = await BackgroundSubagentControl.result({ parentSessionID: parent.id, taskID: info.taskID })
                expect(r).toBeDefined()
                expect(r!.info.status).toBe("failed")
                expect(r!.info.error).toBeDefined()
                expect(r!.info.error!.message).toBe("prompt failed")
                expect(r!.message).toBeUndefined()
                expect(calls).toBe(0)
              } finally {
                messageModule.get = originalGet
              }
            },
          )
        },
      })
    })

    test("every deferred promise settles before test exits", async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const parent = await Session.create({ title: "parent9" })
          const gate = defer<MessageV2.WithParts>()

          await withPrompt(
            {
              resolve: async (_prompt) => [{ type: "text" as const, text: "resolved" }],
              prompt: async (next) => {
                await Bus.publish(Session.Event.TurnOpen, { sessionID: next.sessionID })
                return gate.promise
              },
            },
            async () => {
              const info = await BackgroundSubagentControl.start(makeInput({ parentSessionID: parent.id }))
              gate.resolve({ info: { id: mid() }, parts: [] } as unknown as MessageV2.WithParts)
              await gate.promise
              await Bun.sleep(20)
              expect(BackgroundTask.get(info.taskID)!.status).toBe("completed")
            },
          )
        },
      })
    })
  })

  test("production source contains required references and excludes forbidden patterns", async () => {
    const { readFileSync } = await import("fs")
    const content = readFileSync(new URL("../../src/kilocode/background-subagent-control.ts", import.meta.url), "utf-8")

    expect(content).toContain("BackgroundSubagentStart.start")
    expect(content).toContain("BackgroundTask.get")
    expect(content).toContain("MessageV2.get")
    expect(content).toContain("BackgroundTaskSessionCancel.cancel")
    expect(content).toContain("claims.set")
    expect(content).toContain("claims.get")

    expect(content).not.toContain("Tool.define")
    expect(content).not.toContain("background_task")
    expect(content).not.toContain("Agent")
    expect(content).not.toContain("Config")
    expect(content).not.toContain("Session.create")
    expect(content).not.toContain("SessionPrompt")
    expect(content).not.toContain("BackgroundTask.create")
    expect(content).not.toContain("transitionToRunning")
    expect(content).not.toContain("transitionToCompleted")
    expect(content).not.toContain("transitionToFailed")
    expect(content).not.toContain("transitionToCancelled")
    expect(content).not.toContain("ownerToken:")
    expect(content).not.toContain("JSON.stringify")
    expect(content).not.toContain("file writes")
    expect(content).not.toContain("database writes")
    expect(content).not.toContain("setInterval")
    expect(content).not.toContain("setTimeout")
  })
})
