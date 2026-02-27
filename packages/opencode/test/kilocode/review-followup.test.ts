import { describe, expect, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { ReviewFollowup } from "../../src/kilocode/review-followup"
import { Review } from "../../src/kilocode/review/review"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const model = {
  providerID: "openai",
  modelID: "gpt-4",
}

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({ directory: tmp.path, fn })
}

async function seed() {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    time: {
      created: Date.now(),
    },
    agent: "code",
    model,
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "Implement feature",
  })

  const assistant: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    time: {
      created: Date.now(),
    },
    parentID: user.id,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "code",
    agent: "code",
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    finish: "end_turn",
  }
  await Session.updateMessage(assistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: assistant.id,
    sessionID: session.id,
    type: "tool",
    callID: Identifier.ascending("tool"),
    tool: "edit",
    state: {
      status: "completed",
      input: {},
      output: "done",
      title: "edit",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)

  return {
    sessionID: session.id,
    messages: await Session.messages({ sessionID: session.id }),
  }
}

async function latestUser(sessionID: string) {
  const messages = await Session.messages({ sessionID })
  return messages
    .slice()
    .reverse()
    .find((item) => item.info.role === "user")
}

describe("review follow-up", () => {
  test("ask returns break when dismissed", () =>
    withInstance(async () => {
      const seeded = await seed()
      const pending = ReviewFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const list = await Question.list()
      expect(list).toHaveLength(1)
      await Question.reject(list[0].id)

      await expect(pending).resolves.toBe("break")
    }))

  test("ask injects review kickoff prompt when accepted", () =>
    withInstance(async () => {
      const seeded = await seed()
      const review = spyOn(Review, "buildReviewPromptUncommitted").mockResolvedValue("Run local review now")
      await using _spy = {
        [Symbol.dispose]() {
          review.mockRestore()
        },
      }

      const pending = ReviewFollowup.ask({
        sessionID: seeded.sessionID,
        messages: seeded.messages,
        abort: AbortSignal.any([]),
      })

      const list = await Question.list()
      await Question.reply({
        requestID: list[0].id,
        answers: [[ReviewFollowup.ANSWER_START]],
      })

      await expect(pending).resolves.toBe("continue")
      expect(review).toHaveBeenCalledTimes(1)

      const user = await latestUser(seeded.sessionID)
      expect(user?.info.role).toBe("user")
      if (!user || user.info.role !== "user") return
      expect(user.info.agent).toBe("code")

      const part = user.parts.find((item) => item.type === "text")
      expect(part?.type).toBe("text")
      if (!part || part.type !== "text") return
      expect(part.text).toBe("Run local review now")
      expect(part.synthetic).toBe(true)
    }))
})
