import { expect, test } from "bun:test"
import { Agent } from "@opencode/schema/agent"
import { PlanFollowup } from "../src/plan/plan-followup"
import { handoff } from "./plan-harness"

test("a plan_exit turn asks once, after the session agent changed, although idle runs twice", async () => {
  const result = await handoff({ answer: PlanFollowup.KEEP_REFINING })
  expect(result.asked).toHaveLength(1)
})

test("a turn without plan_exit does not ask", async () => {
  const result = await handoff({ exit: false })
  expect(result.asked).toHaveLength(0)
})

test("a plan_exit from an agent that is not a planner does not ask", async () => {
  const result = await handoff({ exitAgent: Agent.ID.make("code") })
  expect(result.asked).toHaveLength(0)
})

test("the architect agent owns a planning turn too", async () => {
  const result = await handoff({ exitAgent: Agent.ID.make("architect"), answer: PlanFollowup.KEEP_REFINING })
  expect(result.asked).toHaveLength(1)
})
