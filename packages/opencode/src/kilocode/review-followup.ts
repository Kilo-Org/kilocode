import { Identifier } from "@/id/id"
import { Question } from "@/question"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Review } from "@/kilocode/review/review"

export namespace ReviewFollowup {
  export const ANSWER_START = "Start code review"

  async function inject(input: { sessionID: string; model: MessageV2.User["model"]; text: string }) {
    const msg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: input.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "code",
      model: input.model,
    }
    await Session.updateMessage(msg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: msg.id,
      sessionID: input.sessionID,
      type: "text",
      text: input.text,
      synthetic: true,
    } satisfies MessageV2.TextPart)
  }

  function prompt(input: { sessionID: string; abort: AbortSignal }) {
    const promise = Question.ask({
      sessionID: input.sessionID,
      questions: [
        {
          question: "Start an immediate review of uncommitted changes?",
          header: "Code review",
          custom: false,
          options: [
            {
              label: ANSWER_START,
              description: "Run a local review for current uncommitted changes",
            },
          ],
        },
      ],
    })

    const listener = () =>
      Question.list().then((qs) => {
        const match = qs.find((q) => q.sessionID === input.sessionID)
        if (match) Question.reject(match.id)
      })
    input.abort.addEventListener("abort", listener, { once: true })

    return promise
      .catch((error) => {
        if (error instanceof Question.RejectedError) return undefined
        throw error
      })
      .finally(() => {
        input.abort.removeEventListener("abort", listener)
      })
  }

  export async function ask(input: {
    sessionID: string
    messages: MessageV2.WithParts[]
    abort: AbortSignal
  }): Promise<"continue" | "break"> {
    if (input.abort.aborted) return "break"

    const user = input.messages
      .slice()
      .reverse()
      .find((msg) => msg.info.role === "user")?.info
    if (!user || user.role !== "user" || !user.model) return "break"

    const answers = await prompt({ sessionID: input.sessionID, abort: input.abort })
    const answer = answers?.[0]?.[0]?.trim()
    if (answer !== ANSWER_START) return "break"

    const text = await Review.buildReviewPromptUncommitted()
    await inject({
      sessionID: input.sessionID,
      model: user.model,
      text,
    })
    return "continue"
  }
}
