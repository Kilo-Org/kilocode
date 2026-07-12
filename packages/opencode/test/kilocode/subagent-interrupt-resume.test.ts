import { afterEach, describe, expect, test } from "bun:test"
import { ForegroundTask } from "../../src/kilocode/foreground-task"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
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
  metadata?: (value: unknown) => void
}) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "orchestrator",
    callID: `call-${MessageID.ascending()}`,
    abort: new AbortController().signal,
    metadata(value: unknown) {
      input.metadata?.(value)
    },
    async ask() {},
  } as any
}

async function append(sessionID: SessionID, text: string) {
  const userID = MessageID.ascending()
  await Session.updateMessage({
    id: userID,
    role: "user",
    sessionID,
    agent: "alpha",
    model: { providerID, modelID },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: userID,
    sessionID,
    type: "text",
    text,
  })
  return userID
}

afterEach(async () => {
  await resetDatabase()
})

describe("kilocode subagent interrupt resume", () => {
  test("resumes the same child session with the returned task_id and preserves prior messages", async () => {
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
        const first = deferred<MessageV2.WithParts>()
        let childID: SessionID | undefined
        let resumedID: SessionID | undefined
        let firstID: MessageID | undefined
        let secondID: MessageID | undefined
        let calls = 0
        const orig = SessionPrompt.prompt

        ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
          calls++
          if (calls === 1) {
            childID = SessionID.make(input.sessionID)
            firstID = await append(childID, "first child context")
            return first.promise
          }
          resumedID = SessionID.make(input.sessionID)
          secondID = await append(resumedID, "second child context")
          return { parts: [{ type: "text", text: "resumed" }] }
        }

        try {
          const firstRun = tool.execute(
            {
              description: "first",
              prompt: "hold once",
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
          await SessionPrompt.cancel(childID)
          const interrupted = await firstRun
          expect(interrupted.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })
          expect(interrupted.output).toContain(`task_id: ${childID}`)
          expect(await Session.get(childID)).toBeDefined()

          first.reject(new Error("late child rejection"))
          await Bun.sleep(0)

          expect(firstID).toBeDefined()
          await MessageV2.get({ sessionID: childID, messageID: firstID! })
          const count = Array.from(Session.list()).length

          const resumed = await tool.execute(
            {
              description: "resume",
              prompt: "continue",
              subagent_type: "alpha",
              task_id: childID,
            },
            ctx({
              sessionID: session.id,
              messageID: assistantID,
              metadata(value) {
                const next = (value as { metadata?: { sessionId?: string } })?.metadata?.sessionId
                if (typeof next === "string") resumedID = SessionID.make(next)
              },
            }),
          )

          expect(resumedID).toBe(childID)
          expect(Array.from(Session.list()).length).toBe(count)
          expect(resumed.output).toContain(`task_id: ${childID}`)
          expect(resumed.output).toContain("resumed")

          expect(secondID).toBeDefined()
          await MessageV2.get({ sessionID: childID, messageID: firstID! })
          await MessageV2.get({ sessionID: childID, messageID: secondID! })
        } finally {
          ;(SessionPrompt as any).prompt = orig
        }
      },
    })
  }, 15000)

  test("old disposer cannot remove a resumed registry entry for the same task_id", async () => {
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
        const first = deferred<MessageV2.WithParts>()
        const second = deferred<MessageV2.WithParts>()
        const startedSecond = deferred<void>()
        let childID: SessionID | undefined
        let resumedID: SessionID | undefined
        let calls = 0
        const orig = SessionPrompt.prompt

        ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
          calls++
          if (calls === 1) {
            childID = SessionID.make(input.sessionID)
            return first.promise
          }
          resumedID = SessionID.make(input.sessionID)
          startedSecond.resolve()
          return second.promise
        }

        try {
          const firstRun = tool.execute(
            {
              description: "first",
              prompt: "hold",
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
          await SessionPrompt.cancel(childID)
          const interrupted = await firstRun
          expect(interrupted.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })

          const count = Array.from(Session.list()).length
          const resumedRun = tool.execute(
            {
              description: "resume",
              prompt: "resume",
              subagent_type: "alpha",
              task_id: childID,
            },
            ctx({
              sessionID: session.id,
              messageID: assistantID,
              metadata(value) {
                const next = (value as { metadata?: { sessionId?: string } })?.metadata?.sessionId
                if (typeof next === "string") resumedID = SessionID.make(next)
              },
            }),
          )

          await startedSecond.promise
          expect(resumedID).toBe(childID)
          expect(ForegroundTask.has(childID)).toBe(true)

          first.reject(new Error("old child finally rejected"))
          await Bun.sleep(0)

          expect(ForegroundTask.has(childID)).toBe(true)
          expect(Array.from(Session.list()).length).toBe(count)

          await SessionPrompt.cancel(childID)
          const resumed = await resumedRun
          expect(resumed.metadata).toMatchObject({
            sessionId: childID,
            interrupted: true,
          })
          expect(ForegroundTask.has(childID)).toBe(false)
          expect(Array.from(Session.list()).length).toBe(count)
        } finally {
          second.reject(new Error("late resumed rejection"))
          await Bun.sleep(0)
          ;(SessionPrompt as any).prompt = orig
        }
      },
    })
  }, 15000)
})
