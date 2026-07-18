import { describe, expect, test } from "bun:test"
import {
  initialProjectLifecycle,
  transitionProjectLifecycle,
  type ProjectLifecycleEvent,
  type ProjectLifecycleState,
} from "../../src/agent-manager/project-lifecycle"

describe("project-lifecycle", () => {
  test("initial state is active", () => {
    expect(initialProjectLifecycle()).toBe("active")
  })

  test("an active project becomes unavailable when its root is missing", () => {
    expect(transitionProjectLifecycle("active", { type: "missing" })).toBe("unavailable")
  })

  test("an unavailable project returns to active when it is relinked", () => {
    expect(transitionProjectLifecycle("unavailable", { type: "relink" })).toBe("active")
  })

  test("an active project can be removed from the registry", () => {
    expect(transitionProjectLifecycle("active", { type: "remove" })).toBe("removed")
  })

  test("an unavailable project can be removed from the registry", () => {
    expect(transitionProjectLifecycle("unavailable", { type: "remove" })).toBe("removed")
  })

  test("a removed project is terminal: subsequent events stay removed", () => {
    const cases: ProjectLifecycleEvent[] = [{ type: "missing" }, { type: "relink" }, { type: "remove" }]
    for (const event of cases) {
      expect(transitionProjectLifecycle("removed", event)).toBe("removed")
    }
  })

  test("an unavailable project stays unavailable on a redundant missing event", () => {
    expect(transitionProjectLifecycle("unavailable", { type: "missing" })).toBe("unavailable")
  })

  test("an active project stays active on a redundant relink event", () => {
    expect(transitionProjectLifecycle("active", { type: "relink" })).toBe("active")
  })

  test("every state has exactly the allowed transitions", () => {
    const allowed: Record<ProjectLifecycleState, Record<ProjectLifecycleEvent["type"], ProjectLifecycleState>> = {
      active: { missing: "unavailable", relink: "active", remove: "removed" },
      unavailable: { missing: "unavailable", relink: "active", remove: "removed" },
      removed: { missing: "removed", relink: "removed", remove: "removed" },
    }
    const states: ProjectLifecycleState[] = ["active", "unavailable", "removed"]
    const events: ProjectLifecycleEvent[] = [{ type: "missing" }, { type: "relink" }, { type: "remove" }]
    for (const state of states) {
      for (const event of events) {
        expect(transitionProjectLifecycle(state, event)).toBe(allowed[state][event.type])
      }
    }
  })
})
