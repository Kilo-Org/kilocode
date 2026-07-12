import { afterEach, describe, expect, test } from "bun:test"
import { ForegroundTask } from "../../src/kilocode/foreground-task"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { TaskTool } from "../../src/tool/task"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const providerID = ProviderID.make("openai")
const modelID = ModelID.make("gpt-4")

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function seed() {
  const session = await Session.create({})
  const userID = MessageID.ascending()
  const assistantID = MessageID.ascending()

  await Session.updateMessage({
    id: userID,
    role: "user",
    sessionID: session.id,
    agent: "orchestrator",
    model: { providerID, modelID },
    time: { created: Date.now() },
  })
  await Session.updateMessage({
    id: assistantID,
    role: "assistant",
    parentID: userID,
    sessionID: session.id,
    agent: "orchestrator",
    mode: "orchestrator",
    path: { cwd: Instance.directory, root: Instance.worktree },
    time: { created: Date.now() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID,
    providerID,
  })

  return { session, assistantID }
}

function ctx(input: {
  sessionID: SessionID
  messageID: MessageID
  abort?: AbortSignal
  metadata?: (value: unknown) => void
}) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "orchestrator",
    callID: `call-${MessageID.ascending()}`,
    abort: input.abort ?? new AbortController().signal,
    metadata(value: unknown) {
      input.metadata?.(value)
    },
    async ask() {},
  } as any
}

afterEach(async () => {
  await resetDatabase()
})

describe("kilocode subagent interrupt gate", () => {
  test("nonreturning child gate releases TaskTool.execute and consumes late rejection", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          alpha: { mode: "subagent" },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistantID } = await seed()
        const tool = await TaskTool.init()
        const child = deferred<MessageV2.WithParts>()
        const cancelled = deferred<void>()
        let childID: SessionID | undefined
        let ticks = 0
        let unhandled = 0
        const onUnhandled = () => {
          unhandled++
        }
        process.on("unhandledRejection", onUnhandled)
        const orig = SessionPrompt.prompt

        ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
          childID = SessionID.make(input.sessionID)
          await SessionStatus.set(childID, { type: "busy" })
          const work = setInterval(() => {
            ticks++
          }, 10)
          const stop = setInterval(async () => {
            if (!childID || (await SessionStatus.get(childID)).type !== "idle") return
            clearInterval(work)
            clearInterval(stop)
            cancelled.resolve()
          }, 10)
          return child.promise
        }

        try {
          const run = tool.execute(
            {
              description: "hang",
              prompt: "hang once",
              subagent_type: "alpha",
            },
            ctx({
              sessionID: session.id,
              messageID: assistantID,
              metadata(value) {
                const next = (value as { metadata?: { sessionId?: string } })?.metadata?.sessionId
                if (typeof next === "string") childID = SessionID.make(next)
              },
            }),
          )

          while (!childID) await Bun.sleep(10)
          expect(ForegroundTask.has(childID)).toBe(true)

          await SessionPrompt.cancel(childID)
          await cancelled.promise

          const result = await Promise.race([
            run,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for interrupt")), 1000)),
          ])

          expect(result.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })
          expect(result.output).toContain(`task_id: ${childID}`)
          expect(ForegroundTask.has(childID)).toBe(false)
          const before = ticks
          await Bun.sleep(50)
          expect(ticks).toBe(before)

          child.reject(new Error("late child rejection"))
          await Bun.sleep(0)
          expect(unhandled).toBe(0)
          expect(result.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })
        } finally {
          process.off("unhandledRejection", onUnhandled)
          ;(SessionPrompt as any).prompt = orig
        }
      },
    })
  }, 15000)

  test("already-aborted parent returns interrupted without starting a child prompt", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          alpha: { mode: "subagent" },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistantID } = await seed()
        const tool = await TaskTool.init()
        const abort = new AbortController()
        abort.abort()
        let childID: SessionID | undefined
        let starts = 0
        const orig = SessionPrompt.prompt

        ;(SessionPrompt as any).prompt = async () => {
          starts++
          return { parts: [] }
        }

        try {
          const result = await tool.execute(
            {
              description: "aborted",
              prompt: "should not start",
              subagent_type: "alpha",
            },
            ctx({
              sessionID: session.id,
              messageID: assistantID,
              abort: abort.signal,
              metadata(value) {
                const next = (value as { metadata?: { sessionId?: string } })?.metadata?.sessionId
                if (typeof next === "string") childID = SessionID.make(next)
              },
            }),
          )

          expect(childID).toBeDefined()
          expect(starts).toBe(0)
          expect(result.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })
          expect(result.output).toContain(`task_id: ${childID}`)
          expect(ForegroundTask.has(childID!)).toBe(false)
        } finally {
          ;(SessionPrompt as any).prompt = orig
        }
      },
    })
  }, 15000)
})
