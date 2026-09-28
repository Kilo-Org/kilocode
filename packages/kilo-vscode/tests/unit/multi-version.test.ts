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
  test.each(["high", ""])("preserves model, agent, and effort %s without an initial prompt", (variant) => {
    const model = { providerID: "a", modelID: "m1" }
    const messages = buildInitialMessages(created(1), [], model, undefined, "plan", variant)
    expect(messages.at(0)).toEqual({ sessionId: "ses-0", worktreeId: "wt-0", ...model, agent: "plan", variant })
    const comparisons = buildInitialMessages(created(1), [{ ...model, variant }], {}, "", "plan", "low")
    expect(comparisons.at(0)).toEqual(messages.at(0))
  })

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

  test("routes a command initial prompt instead of literal text", () => {
    const msgs = buildInitialMessages(
      created(1),
      [],
      { providerID: "a", modelID: "m1" },
      undefined,
      "code",
      "high",
      undefined,
      { command: "goal", arguments: "ship it" },
    )
    expect(msgs[0]).toEqual({
      sessionId: "ses-0",
      worktreeId: "wt-0",
      providerID: "a",
      modelID: "m1",
      agent: "code",
      variant: "high",
      command: "goal",
      arguments: "ship it",
      files: undefined,
    })
  })

  test("keeps attachments on a command initial prompt", () => {
    const files = [{ mime: "image/png", url: "data:image/png;base64,aaa" }]
    const msgs = buildInitialMessages(
      created(1),
      [],
      { providerID: "a", modelID: "m1" },
      undefined,
      undefined,
      undefined,
      files,
      { command: "grill", arguments: "" },
    )
    expect(msgs[0]?.command).toBe("grill")
    expect(msgs[0]?.text).toBeUndefined()
    expect(msgs[0]?.files).toEqual(files)
  })
})
