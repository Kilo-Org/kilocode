import { describe, expect, test } from "bun:test"
import { AutonomousScheduler } from "@/kilocode/autonomous/scheduler"
import type { AutonomousState } from "@/kilocode/autonomous/state"

const task = (id: string, dependsOn: string[] = [], status: AutonomousState.TaskStatus = "pending"): AutonomousState.Task => ({
  id,
  title: id,
  description: id,
  type: "implementation",
  status,
  complexity: 1,
  dependsOn,
  relevantFiles: [],
  acceptanceCriteria: [],
  risk: {},
  preferredModelClass: "local-coder",
  attempts: 0,
  maxAttempts: 2,
  escalated: false,
  failures: [],
})

describe("AutonomousScheduler", () => {
  test("validates unknown, self and cyclic dependencies", () => {
    expect(AutonomousScheduler.validate([task("a"), task("b", ["a"])])).toEqual([])
    expect(AutonomousScheduler.validate([task("a", ["zzz"])])[0]?.message).toContain("unknown")
    expect(AutonomousScheduler.validate([task("a", ["a"])])[0]?.message).toContain("itself")
    const cycle = AutonomousScheduler.validate([task("a", ["c"]), task("b", ["a"]), task("c", ["b"]), task("d")])
    expect(cycle.map((p) => p.taskID).sort()).toEqual(["a", "b", "c"])
    expect(AutonomousScheduler.validate([task("a"), task("a")])[0]?.message).toContain("Duplicate")
  })

  test("chain, fan-out and fan-in ordering", () => {
    const chain = { tasks: [task("a"), task("b", ["a"]), task("c", ["b"])] }
    expect(AutonomousScheduler.next(chain)?.id).toBe("a")
    chain.tasks[0]!.status = "completed"
    expect(AutonomousScheduler.next(chain)?.id).toBe("b")

    const fan = { tasks: [task("root"), task("x", ["root"]), task("y", ["root"]), task("join", ["x", "y"])] }
    fan.tasks[0]!.status = "completed"
    expect(AutonomousScheduler.ready(fan).map((t) => t.id)).toEqual(["x", "y"])
    fan.tasks[1]!.status = "completed"
    expect(AutonomousScheduler.ready(fan).map((t) => t.id)).toEqual(["y"])
    fan.tasks[2]!.status = "completed"
    expect(AutonomousScheduler.next(fan)?.id).toBe("join")
  })

  test("in-flight task is returned before ready ones", () => {
    const state = { tasks: [task("a", [], "completed"), task("b", ["a"], "verifying"), task("c", ["a"])] }
    expect(AutonomousScheduler.next(state)?.id).toBe("b")
  })

  test("failed dependency blocks dependents transitively", () => {
    const state = { tasks: [task("a", [], "failed"), task("b", ["a"]), task("c", ["b"]), task("d")] }
    expect(AutonomousScheduler.propagate(state).sort()).toEqual(["b", "c"])
    expect(state.tasks.map((t) => t.status)).toEqual(["failed", "blocked", "blocked", "pending"])
    expect(AutonomousScheduler.next(state)?.id).toBe("d")
    expect(AutonomousScheduler.done(state)).toBe(false)
  })

  test("merge keeps completed and failed tasks, replaces pending ones", () => {
    const state = { tasks: [task("a", [], "completed"), task("b", ["a"], "failed"), task("c", ["a"], "blocked")] }
    const merged = AutonomousScheduler.merge(state, [
      { ...task("a"), title: "renamed" },
      { ...task("c", ["a"]), description: "new c" },
      task("d", ["c"]),
    ])
    expect(merged.map((t) => [t.id, t.status])).toEqual([
      ["a", "completed"],
      ["c", "pending"],
      ["d", "pending"],
      ["b", "failed"],
    ])
    expect(merged[0]?.title).toBe("a")
    expect(merged[1]?.description).toBe("new c")
  })
})
