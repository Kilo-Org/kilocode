// kilocode_change - new file
import { describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  CreateElicitationRequest,
  CreateElicitationResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk"
import type { Event, KiloClient } from "@kilocode/sdk/v2"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, ManagedRuntime } from "effect"
import { ACPEvent } from "@/acp/event"
import { ACPQuestion } from "@/acp/question"
import { ACPSession } from "@/acp/session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type ReplyParams = Parameters<KiloClient["question"]["reply"]>[0]
type RejectParams = Parameters<KiloClient["question"]["reject"]>[0]
type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]

const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  message: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
) => {
  const started = Date.now()
  while (true) {
    if (await check()) return
    if (Date.now() - started > (opts?.timeoutMs ?? 2000)) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, opts?.intervalMs ?? 5))
  }
}

function makeSessionService() {
  return ManagedRuntime.make(LayerNode.compile(ACPSession.node)).runSync(
    ACPSession.Service.use((service) => Effect.succeed(service)),
  )
}

function createHarness(
  respond: (params: CreateElicitationRequest) => Promise<CreateElicitationResponse> = () =>
    Promise.resolve({ action: "accept", content: {} }),
  capabilities = { elicitation: true },
) {
  const replies: ReplyParams[] = []
  const rejects: RejectParams[] = []
  const requests: CreateElicitationRequest[] = []
  const updates: SessionUpdateParams[] = []
  const session = makeSessionService()
  const sdk = {
    question: {
      reply: (params: ReplyParams) => {
        replies.push(params)
        return Promise.resolve({ data: true })
      },
      reject: (params: RejectParams) => {
        rejects.push(params)
        return Promise.resolve({ data: true })
      },
    },
  } as unknown as KiloClient
  const connection = {
    unstable_createElicitation: (params: CreateElicitationRequest) => {
      requests.push(params)
      return respond(params)
    },
    sessionUpdate: (params: SessionUpdateParams) => {
      updates.push(params)
      return Promise.resolve()
    },
  } satisfies Pick<AgentSideConnection, "unstable_createElicitation" | "sessionUpdate">
  const subscription = new ACPEvent.Subscription({ sdk, connection, session, capabilities })

  return { connection, rejects, replies, requests, sdk, session, subscription, updates }
}

async function createSession(session: ACPSession.Interface, sessionId: string, cwd = "/workspace") {
  await Effect.runPromise(session.create({ id: sessionId, cwd }))
}

function questionAsked(
  sessionID: string,
  id: string,
  questions: QuestionEvent["properties"]["questions"],
  tool?: { messageID: string; callID: string },
) {
  return {
    id: `evt_${id}`,
    type: "question.asked",
    properties: {
      id,
      sessionID,
      questions,
      ...(tool ? { tool } : {}),
    },
  } as QuestionEvent
}

describe("acp questions", () => {
  it("maps options to a selectable elicitation field", () => {
    const form = ACPQuestion.toElicitation([
      {
        header: "Reader harness and model",
        question: "Which harness should read the sessions?",
        options: [
          { label: "Claude, sonnet (Recommended)", description: "Cheaper model" },
          { label: "Codex", description: "Default model" },
        ],
      },
    ])

    expect(form.message).toBe("Reader harness and model")
    expect(form.ids).toEqual(["question_1"])
    expect(form.schema.properties?.question_1).toEqual({
      type: "string",
      title: "Reader harness and model",
      description: "Which harness should read the sessions?",
      oneOf: [
        { const: "Claude, sonnet (Recommended)", title: "Claude, sonnet (Recommended)" },
        { const: "Codex", title: "Codex" },
      ],
    })
  })

  it("maps multi-select questions to an array field and free text to a string field", () => {
    const form = ACPQuestion.toElicitation([
      {
        header: "Pick some",
        question: "Which files?",
        multiple: true,
        options: [
          { label: "a.ts", description: "A" },
          { label: "b.ts", description: "B" },
        ],
      },
      { header: "Notes", question: "Anything else?", options: [] },
    ])

    expect(form.message).toBe("2 questions need an answer.")
    expect(form.schema.properties?.question_1).toMatchObject({ type: "array" })
    expect(form.schema.properties?.question_2).toEqual({
      type: "string",
      title: "Notes",
      description: "Anything else?",
    })
  })

  it("maps an accepted form back to answer arrays", () => {
    expect(
      ACPQuestion.toAnswers(["question_1", "question_2", "question_3"], {
        action: "accept",
        content: { question_1: "a.ts", question_2: ["a.ts", "b.ts"] },
      }),
    ).toEqual([["a.ts"], ["a.ts", "b.ts"], []])
  })

  it("answers the pending question with the elicitation result", async () => {
    const harness = createHarness(() =>
      Promise.resolve({ action: "accept", content: { question_1: "Yes, read them" } }),
    )
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      questionAsked(
        "ses_a",
        "que_1",
        [
          {
            header: "Read sessions",
            question: "Open up to 30 example sessions?",
            options: [
              { label: "Yes, read them", description: "Read them" },
              { label: "No", description: "Skip" },
            ],
          },
        ],
        { messageID: "msg_1", callID: "call_1" },
      ),
    )

    await pollUntil(() => harness.replies.length === 1, "question was never replied")

    expect(harness.requests[0]).toMatchObject({
      mode: "form",
      sessionId: "ses_a",
      toolCallId: "call_1",
      message: "Read sessions",
    })
    expect(harness.replies).toEqual([{ requestID: "que_1", answers: [["Yes, read them"]], directory: "/workspace" }])
  })

  it("rejects the question when the user declines the elicitation", async () => {
    const harness = createHarness(() => Promise.resolve({ action: "decline" }))
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      questionAsked("ses_a", "que_2", [{ header: "Confirm", question: "Continue?", options: [] }]),
    )

    await pollUntil(() => harness.rejects.length === 1, "question was never rejected")
    expect(harness.replies).toEqual([])
    expect(harness.rejects).toEqual([{ requestID: "que_2", directory: "/workspace" }])
  })

  it("leaves questions alone when the client cannot render forms", async () => {
    const harness = createHarness(undefined, { elicitation: false })
    await createSession(harness.session, "ses_a")

    harness.subscription.handle(
      questionAsked("ses_a", "que_3", [{ header: "Confirm", question: "Continue?", options: [] }]),
    )

    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(harness.requests).toEqual([])
    expect(harness.replies).toEqual([])
    expect(harness.rejects).toEqual([])
  })
})
