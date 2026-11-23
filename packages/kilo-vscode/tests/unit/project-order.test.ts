import { describe, expect, it } from "bun:test"
import { applyProjectOrder, moveProject, projectDrop } from "../../webview-ui/agent-manager/project-order"

const rows = [
  { id: "a", top: 0, bottom: 30 },
  // An expanded project is much taller than a collapsed one.
  { id: "b", top: 30, bottom: 330 },
  { id: "c", top: 330, bottom: 360 },
]

describe("projectDrop", () => {
  it("uses the row half under the pointer", () => {
    expect(projectDrop(rows, 10)).toEqual({ id: "a", after: false })
    expect(projectDrop(rows, 100)).toEqual({ id: "b", after: false })
    expect(projectDrop(rows, 200)).toEqual({ id: "b", after: true })
  })

  it("clamps positions outside the rows", () => {
    expect(projectDrop(rows, -50)).toEqual({ id: "a", after: false })
    expect(projectDrop(rows, 900)).toEqual({ id: "c", after: true })
    expect(projectDrop([], 10)).toBeUndefined()
  })
})

describe("moveProject", () => {
  it("moves a project before or after the target", () => {
    expect(moveProject(["a", "b", "c"], "a", { id: "c", after: true })).toEqual(["b", "c", "a"])
    expect(moveProject(["a", "b", "c"], "c", { id: "a", after: false })).toEqual(["c", "a", "b"])
    expect(moveProject(["a", "b", "c"], "a", { id: "b", after: true })).toEqual(["b", "a", "c"])
  })

  it("returns undefined when the order does not change", () => {
    expect(moveProject(["a", "b", "c"], "a", { id: "b", after: false })).toBeUndefined()
    expect(moveProject(["a", "b", "c"], "b", { id: "a", after: true })).toBeUndefined()
    expect(moveProject(["a", "b", "c"], "b", { id: "b", after: true })).toBeUndefined()
    expect(moveProject(["a", "b"], "x", { id: "a", after: false })).toBeUndefined()
  })
})

describe("applyProjectOrder", () => {
  const projects = [
    { id: "p", pinned: true },
    { id: "a", pinned: false },
    { id: "b", pinned: false },
    { id: "c", pinned: false },
  ]

  it("keeps the pinned project first and unlisted projects last", () => {
    expect(applyProjectOrder(projects, ["c", "p", "a"]).map((p) => p.id)).toEqual(["p", "c", "a", "b"])
  })

  it("returns the snapshots without a local order", () => {
    expect(applyProjectOrder(projects)).toBe(projects)
  })
})
