import { expect, test } from "bun:test"
import { Generate } from "@opencode/core/generate"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect, Exit } from "effect"
import { PlanHandover } from "../src/plan/handover"
import { PlanFollowup } from "../src/plan/plan-followup"
import { code, handoff, nextSessionID, planPath, sessionID } from "./plan-harness"

test("the question offers the three answers with modes and i18n keys", async () => {
  const result = await handoff({ answer: PlanFollowup.KEEP_REFINING })
  const field = result.asked[0]?.fields[0]
  expect(field).toMatchObject({ title: "Implement", description: "Ready to implement?" })
  expect(field?.type === "string" ? field.options?.map((option) => option.value) : []).toEqual([
    PlanFollowup.NEW_SESSION,
    PlanFollowup.CONTINUE,
    PlanFollowup.KEEP_REFINING,
  ])
  expect(result.asked[0]?.metadata).toMatchObject({
    kilocode: { options: { q0: { [PlanFollowup.CONTINUE]: { mode: "code", labelKey: "plan.followup.answer.continue" } } } },
  })
})

test("Continue here switches the session to Code and starts the implementation", async () => {
  const result = await handoff({ answer: PlanFollowup.CONTINUE })
  expect(result.switched).toEqual([code])
  expect(result.prompted).toEqual([{ sessionID, text: "Implement the plan above." }])
})

test("Keep refining stays in Plan", async () => {
  const result = await handoff({ answer: PlanFollowup.KEEP_REFINING })
  expect(result.switched).toEqual([])
  expect(result.prompted).toEqual([
    {
      sessionID,
      text: "Continue refining the plan. Do not implement yet. When the refined plan is ready, update the plan file and call plan_exit again.",
    },
  ])
})

test("a typed answer goes to the planning session as a prompt", async () => {
  const result = await handoff({ answer: "Also cover the login page" })
  expect(result.prompted).toEqual([{ sessionID, text: "Also cover the login page" }])
})

test("a blank answer does nothing", async () => {
  const result = await handoff({ answer: "  " })
  expect(result.prompted).toEqual([])
})

test("Start new session opens a Code session with the plan file, the handover and the todos", async () => {
  const result = await handoff({
    answer: PlanFollowup.NEW_SESSION,
    handover: "## Discoveries\nThe theme cache lives in theme.ts.",
    todos: [
      { content: "Add the toggle", status: "completed" },
      { content: "Add CSS variables", status: "pending" },
    ],
  })
  expect(result.createdAgents).toEqual([code])
  // The Code agent has no model of its own, so the new session keeps the model that wrote the plan.
  expect(result.createdModels).toEqual([{ id: "test-model", providerID: "test" }])
  expect(result.published).toEqual([nextSessionID])
  expect(result.generated[0]?.system).toBe(PlanHandover.PROMPT)
  expect(result.generated[0]?.prompt).toContain("User: Plan dark mode")
  expect(result.prompted).toEqual([
    {
      sessionID: nextSessionID,
      text: [
        `Plan file: ${planPath}\nRead this file first and treat it as the source of truth for implementation.`,
        "## Handover from Planning Session\n\n## Discoveries\nThe theme cache lives in theme.ts.",
        "## Todo List\n\n- [x] Add the toggle\n- [ ] Add CSS variables",
      ].join("\n\n"),
    },
  ])
})

test("Start new session still hands off the plan file when the handover summary fails", async () => {
  const result = await handoff({ answer: PlanFollowup.NEW_SESSION, handover: new Generate.UnavailableError({ message: "model unavailable" }) })
  expect(result.prompted).toEqual([
    {
      sessionID: nextSessionID,
      text: `Plan file: ${planPath}\nRead this file first and treat it as the source of truth for implementation.`,
    },
  ])
})

test("the handover transcript keeps the newest text when the session is long", () => {
  const created = DateTime.makeUnsafe(0)
  const messages: SessionMessage.Info[] = [
    { id: SessionMessage.ID.create(), time: { created }, type: "user", text: "old ".repeat(20_000) },
    { id: SessionMessage.ID.create(), time: { created }, type: "user", text: "newest question" },
  ]
  const transcript = PlanHandover.render(messages)
  expect(transcript.length).toBe(60_000)
  expect(transcript.endsWith("User: newest question")).toBe(true)
})

test("the handover transcript carries tool input and output, so the summary sees real file contents", () => {
  const created = DateTime.makeUnsafe(0)
  const transcript = PlanHandover.render([
    {
      id: SessionMessage.ID.create(),
      time: { created },
      type: "assistant",
      agent: Agent.ID.make("plan"),
      model: { id: Model.ID.make("m"), providerID: Provider.ID.make("p") },
      content: [
        {
          type: "tool",
          id: Tool.CallID.make("call-read"),
          name: "read",
          time: { created },
          state: {
            status: "completed",
            input: { path: "math.ts" },
            content: [{ type: "text", text: 'export const VERSION = "1.2.3"\n' + "x".repeat(10_000) }],
          },
        },
      ],
    },
  ])
  expect(transcript).toContain('[tool read] {"path":"math.ts"}')
  expect(transcript).toContain('export const VERSION = "1.2.3"')
  expect(transcript).toContain("[truncated]")
  expect(transcript.length).toBeLessThan(4_200)
})

test("a user interruption during the handover summary stops the handoff, a failure does not", async () => {
  const messages: SessionMessage.Info[] = [
    { id: SessionMessage.ID.create(), time: { created: DateTime.makeUnsafe(0) }, type: "user", text: "Plan it" },
  ]
  const interrupted = await Effect.runPromiseExit(PlanHandover.generate({ messages, generate: () => Effect.interrupt }))
  expect(Exit.hasInterrupts(interrupted)).toBe(true)
  const failed = await Effect.runPromise(
    PlanHandover.generate({ messages, generate: () => Effect.fail(new Error("unavailable")) }),
  )
  expect(failed).toBe("")
})
