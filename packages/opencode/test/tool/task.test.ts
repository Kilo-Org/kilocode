import { afterEach, describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { MessageID } from "../../src/session/schema"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { TaskTool } from "../../src/tool/task"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.task", () => {
  test("description sorts subagents by name and is stable across calls", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await Agent.get("build")
        const first = await TaskTool.init({ agent: build })
        const second = await TaskTool.init({ agent: build })

        expect(first.description).toBe(second.description)

        const alpha = first.description.indexOf("- alpha: Alpha agent")
        const explore = first.description.indexOf("- explore:")
        const general = first.description.indexOf("- general:")
        const zebra = first.description.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      },
    })
  })

  test("throws an error when the same subagent_type is dispatched twice in parallel from the same session", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          orchestrator: {},
          alpha: { mode: "subagent" },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const tool = await TaskTool.init()

        const userMsgId = MessageID.ascending()
        const asstId = MessageID.ascending()

        await Session.updateMessage({
          id: userMsgId,
          role: "user",
          sessionID: session.id,
          agent: "orchestrator",
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
          time: { created: Date.now() },
        })
        const asstData = {
          role: "assistant" as const,
          parentID: userMsgId,
          sessionID: session.id,
          agent: "orchestrator",
          mode: "orchestrator",
          path: { cwd: Instance.directory, root: Instance.worktree },
          time: { created: Date.now() },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ModelID.make("gpt-4"),
          providerID: ProviderID.make("openai"),
        }
        await Session.updateMessage({ id: asstId, ...asstData })

        let reachedPrompt: () => void
        const reached = new Promise<void>((r) => {
          reachedPrompt = r
        })
        let releaseFirst: () => void
        const hang = new Promise<void>((r) => {
          releaseFirst = r
        })

        const orig = (SessionPrompt as any).prompt
        ;(SessionPrompt as any).prompt = async () => {
          reachedPrompt()
          await hang
          return { parts: [{ type: "text", text: "done" }] }
        }

        try {
          const p1 = tool.execute({ description: "first", prompt: "first prompt", subagent_type: "alpha" }, {
            sessionID: session.id,
            messageID: asstId,
            agent: "orchestrator",
            callID: "call-1",
            abort: new AbortController().signal,
            async metadata() {},
            async ask() {},
          } as any)

          await reached

          const p2 = tool.execute({ description: "second", prompt: "second prompt", subagent_type: "alpha" }, {
            sessionID: session.id,
            messageID: asstId,
            agent: "orchestrator",
            callID: "call-2",
            abort: new AbortController().signal,
            async metadata() {},
            async ask() {},
          } as any)

          const err = await p2.then(
            () => {
              throw new Error("Expected duplicate dispatch to reject")
            },
            (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
          )
          expect(err.message).toContain("Routing bug")
          expect(err.message).toContain("alpha")

          releaseFirst!()
          await p1
        } finally {
          ;(SessionPrompt as any).prompt = orig
          await Session.remove(session.id)
        }
      },
    })
  })
})
