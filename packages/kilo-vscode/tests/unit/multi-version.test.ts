import { describe, expect, test } from "bun:test"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "../../src/agent-manager/multi-version"

const created = (n: number): CreatedVersion[] =>
  Array.from({ length: n }, (_, i) => ({
    worktreeId: `wt-${i}`,
    sessionId: `ses-${i}`,
    path: `/tmp/wt-${i}`,
    branch: `branch-${i}`,
    parentBranch: "main",
    versionIndex: i,
  }))

describe("resolveVersionModels", () => {
  test("expands allocations with per-model variants", () => {
    const { models, versions } = resolveVersionModels(
      [
        { providerID: "a", modelID: "m1", count: 2, variant: "high" },
        { providerID: "b", modelID: "m2", count: 1 },
      ],
      undefined,
      1,
    )
    expect(versions).toBe(3)
    expect(models).toEqual([
      { providerID: "a", modelID: "m1", variant: "high" },
      { providerID: "a", modelID: "m1", variant: "high" },
      { providerID: "b", modelID: "m2", variant: undefined },
    ])
  })

  test("non-compare runs carry no per-version variant", () => {
    const { models } = resolveVersionModels(undefined, { providerID: "a", modelID: "m1" }, 2)
    expect(models).toEqual([])
  })
})

describe("buildInitialMessages", () => {
  test("per-allocation variant wins over the dialog-level variant", () => {
    const models = resolveVersionModels(
      [
        { providerID: "a", modelID: "m1", count: 1, variant: "high" },
        { providerID: "b", modelID: "m2", count: 1 },
      ],
      undefined,
      1,
    ).models
    const msgs = buildInitialMessages(created(2), models, {}, "do it", undefined, "low")
    expect(msgs[0]?.variant).toBe("high")
    expect(msgs[1]?.variant).toBe("low")
  })

  test("falls back to the dialog-level variant when no allocation variant is set", () => {
    const msgs = buildInitialMessages(created(1), [], { providerID: "a", modelID: "m1" }, "do it", undefined, "medium")
    expect(msgs[0]?.variant).toBe("medium")
  })
})
