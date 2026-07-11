import { afterEach, describe, expect, test } from "bun:test"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionID, MessageID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("kilocode subagent interrupt", () => {
  test("cancelled child task returns idle and can resume with the same task_id", async () => {
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
        const session = await Session.create({})
        const tool = await TaskTool.init()
        const userID = MessageID.ascending()
        const assistantID = MessageID.ascending()
        const parentModelID = ModelID.make("gpt-4")
        const parentProviderID = ProviderID.make("openai")

        await Session.updateMessage({
          id: userID,
          role: "user",
          sessionID: session.id,
          agent: "orchestrator",
          model: { providerID: parentProviderID, modelID: parentModelID },
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
          modelID: parentModelID,
          providerID: parentProviderID,
        })

        let childID = ""
        let calls = 0
        const orig = (SessionPrompt as any).prompt
        ;(SessionPrompt as any).prompt = async (input: { sessionID: string }) => {
          calls++
          if (calls === 1) {
            await SessionStatus.set(SessionID.make(input.sessionID), { type: "busy" })
            while ((await SessionStatus.get(SessionID.make(input.sessionID))).type !== "idle") {
              await Bun.sleep(10)
            }
            return { parts: [] }
          }
          return { parts: [{ type: "text", text: "resumed" }] }
        }

        try {
          const first = tool.execute(
            {
              description: "first",
              prompt: "hang once",
              subagent_type: "alpha",
            },
            {
              sessionID: session.id,
              messageID: assistantID,
              agent: "orchestrator",
              callID: "call-1",
              abort: new AbortController().signal,
              metadata(input: any) {
                const next = input?.metadata?.sessionId
                if (typeof next === "string") childID = next
              },
              async ask() {},
            } as any,
          )

          while (!childID) await Bun.sleep(10)
          expect(childID).toBeTruthy()

          await SessionPrompt.cancel(SessionID.make(childID))
          const firstResult = await first
          expect(firstResult.output).toContain(`task_id: ${childID}`)
          expect(await SessionStatus.get(SessionID.make(childID))).toEqual({ type: "idle" })

          let resumedID = ""
          const secondResult = await tool.execute(
            {
              description: "resume",
              prompt: "resume once",
              subagent_type: "alpha",
              task_id: childID,
            },
            {
              sessionID: session.id,
              messageID: assistantID,
              agent: "orchestrator",
              callID: "call-2",
              abort: new AbortController().signal,
              metadata(input: any) {
                const next = input?.metadata?.sessionId
                if (typeof next === "string") resumedID = next
              },
              async ask() {},
            } as any,
          )
          expect(resumedID).toBe(childID)
          expect(secondResult.output).toContain(`task_id: ${childID}`)
          expect(secondResult.output).toContain("resumed")
        } finally {
          ;(SessionPrompt as any).prompt = orig
          await Session.remove(session.id).catch(() => undefined)
        }
      },
    })
  }, 15000)
})
