import { expect } from "bun:test"
import { Effect } from "effect"
import { AutonomousAgents } from "@/kilocode/autonomous/agents"
import { AutonomousRunner } from "@/kilocode/autonomous/runner"
import { reply } from "../../lib/llm-server"
import { it, setup, Sample } from "./fixture"

const model = { providerID: "test", modelID: "coder" }

it.instance(
  "returns decoded structured output with cost and tokens",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().tool("StructuredOutput", { ok: true, items: ["a"] }).usage({ input: 100, output: 10 }))
    const out = yield* AutonomousRunner.run({
      parent: run.root.id,
      title: "sample",
      agent: AutonomousAgents.REVIEWER,
      model,
      schema: Sample,
      text: "Reply with ok true",
    })
    expect(out.value).toEqual({ ok: true, items: ["a"] })
    expect(out.tokens.input).toBe(100)
    expect(out.tokens.output).toBe(10)
    expect(out.cost).toBeGreaterThan(0)
    const hits = yield* run.llm.hits
    expect(hits).toHaveLength(1)
    expect(hits[0]?.body.model).toBe("coder")
    expect(JSON.stringify(hits[0]?.body.tools)).toContain("StructuredOutput")
    expect(JSON.stringify(hits[0]?.body.messages)).toContain("Reply with ok true")
    const child = yield* run.sessions.get(out.sessionID)
    expect(child.parentID).toBe(run.root.id)
  }),
  30_000,
)

it.instance(
  "re-prompts once when the model returns no structured output",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().text("I forgot the tool").stop(), reply().tool("StructuredOutput", { ok: false, items: [] }))
    const out = yield* AutonomousRunner.run({
      parent: run.root.id,
      title: "sample",
      agent: AutonomousAgents.REVIEWER,
      model,
      schema: Sample,
      text: "Reply",
      retries: 1,
    })
    expect(out.value).toEqual({ ok: false, items: [] })
    const hits = yield* run.llm.hits
    expect(hits).toHaveLength(2)
    expect(JSON.stringify(hits[1]?.body.messages)).toContain("rejected")
  }),
  30_000,
)

it.instance(
  "fails after retries are exhausted",
  Effect.gen(function* () {
    const run = yield* setup()
    yield* run.llm.push(reply().text("nope").stop())
    const exit = yield* Effect.exit(
      AutonomousRunner.run({
        parent: run.root.id,
        title: "sample",
        agent: AutonomousAgents.REVIEWER,
        model,
        schema: Sample,
        text: "Reply",
        retries: 0,
      }),
    )
    expect(exit._tag).toBe("Failure")
    expect(String(exit)).toContain("AutonomousRunnerInvalid")
  }),
  30_000,
)
