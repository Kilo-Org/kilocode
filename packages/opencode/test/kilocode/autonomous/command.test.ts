import { expect } from "bun:test"
import { Effect } from "effect"
import { AutonomousStore } from "@/kilocode/autonomous/store"
import { GoalState } from "@/kilocode/session/goal/state"
import { pollWithTimeout } from "../../lib/effect"
import { reply } from "../../lib/llm-server"
import { it, setup } from "./fixture"

const text = (result: { parts: { type: string; text?: string }[] }) => result.parts.map((p) => (p.type === "text" ? p.text : "")).join("")

it.instance(
  "/goal routes to the engine when enabled: help, start, status, pause, clear",
  Effect.gen(function* () {
    const run = yield* setup()
    const command = (args: string) =>
      run.prompt.command({ sessionID: run.root.id, command: "goal", arguments: args, agent: "code", model: "test/cloud" })
    expect(text(yield* command(""))).toContain("Autonomous goal engine")
    yield* run.llm.push(
      reply()
        .tool("StructuredOutput", {
          goal_summary: "s",
          acceptance_criteria: [{ id: "ac1", description: "c" }],
          tasks: [{ id: "t1", title: "t", description: "d", type: "implementation", complexity: 1, dependsOn: [], relevantFiles: [], acceptanceCriteria: ["ac1"], risk: {}, preferredModelClass: "local-coder" }],
          risks: [],
        }),
      reply().hang(),
    )
    expect(text(yield* command("Add a greeting"))).toContain("Autonomous goal started")
    yield* pollWithTimeout(
      AutonomousStore.load(run.root.id).pipe(Effect.map((s) => (s?.tasks.length ? true : undefined))),
      "plan did not land",
      "20 seconds",
    )
    const status = text(yield* command("status"))
    expect(status).toContain("Autonomous goal: running")
    expect(status).toContain("t1")
    expect(text(yield* command("tasks"))).toContain("[ ] t1")
    expect(text(yield* command("budget"))).toContain("cloud 1 calls")
    expect(GoalState.read((yield* run.sessions.get(run.root.id)).metadata)).toMatchObject({ status: "active" })
    expect(text(yield* command("pause"))).toContain("paused")
    expect((yield* AutonomousStore.load(run.root.id))?.status).toBe("paused")
    expect(text(yield* command("clear"))).toContain("cleared")
    expect(yield* AutonomousStore.load(run.root.id)).toBeUndefined()
  }),
  { git: true },
  60_000,
)

it.instance(
  "/goal keeps the standard loop when the engine is disabled",
  Effect.gen(function* () {
    const run = yield* setup({ autonomous_goal: { enabled: false } })
    const result = yield* run.prompt.command({ sessionID: run.root.id, command: "goal", arguments: "", agent: "code", model: "test/cloud" })
    expect(text(result)).toContain("goal_report")
    expect(text(result)).not.toContain("Autonomous")
  }),
  30_000,
)
