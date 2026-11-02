import { describe, expect, test } from "bun:test"
import { assertMutablePath, MESSAGE } from "../src/agent-manager/protection"

describe("Agent Manager state protection", () => {
  test("rejects direct edits to the current and legacy Agent Manager state", () => {
    expect(() => assertMutablePath("/workspace/.kilo2/agent-manager.json")).toThrow(MESSAGE)
    expect(() => assertMutablePath("/workspace/.kilo/agent-manager.json")).toThrow(MESSAGE)
    expect(() => assertMutablePath("C:\\workspace\\.kilo2\\agent-manager.json")).toThrow(MESSAGE)
  })

  test("allows ordinary project files", () => {
    expect(() => assertMutablePath("/workspace/.kilo2/settings.json")).not.toThrow()
    expect(() => assertMutablePath("/workspace/config/agent-manager.json")).not.toThrow()
    expect(() => assertMutablePath("/workspace/src/agent-manager.json")).not.toThrow()
  })
})
describe("mutation tool targets", () => {
  test("resolves write and edit paths against the location", async () => {
    const { mutationTargets } = await import("../src/agent-manager/guard")
    expect(mutationTargets("write", { path: ".kilo2/agent-manager.json" }, "/workspace")).toEqual([
      "/workspace/.kilo2/agent-manager.json",
    ])
    expect(mutationTargets("edit", { path: "/workspace/.kilo/agent-manager.json" }, "/workspace")).toEqual([
      "/workspace/.kilo/agent-manager.json",
    ])
  })

  test("reads add, delete, update, and move paths from a patch", async () => {
    const { mutationTargets } = await import("../src/agent-manager/guard")
    const patch = [
      "*** Begin Patch",
      "*** Add File: .kilo2/agent-manager.json",
      "+{}",
      "*** Update File: src/a.ts",
      "*** Move to: .kilo/agent-manager.json",
      "@@",
      "-a",
      "+b",
      "*** Delete File: docs/old.md",
      "*** End Patch",
    ].join("\n")
    expect(mutationTargets("patch", { patchText: patch }, "/workspace")).toEqual([
      "/workspace/.kilo2/agent-manager.json",
      "/workspace/src/a.ts",
      "/workspace/.kilo/agent-manager.json",
      "/workspace/docs/old.md",
    ])
  })

  test("ignores tools and inputs that cannot carry a path", async () => {
    const { mutationTargets } = await import("../src/agent-manager/guard")
    expect(mutationTargets("read", { path: ".kilo2/agent-manager.json" }, "/workspace")).toEqual([])
    expect(mutationTargets("patch", { patchText: "not a patch" }, "/workspace")).toEqual([])
    expect(mutationTargets("write", { path: 42 }, "/workspace")).toEqual([])
  })
})
