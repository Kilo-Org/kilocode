// Guards on the semantic evaluation. Two kinds: the split has to stay a split, and the layer has to
// stay safe on text it has never seen. Recall is reported by the eval, not asserted as a floor — a
// test that demands a recall number is a test that invites tuning the provider until it passes.
import { describe, expect, test } from "bun:test"
import { DEVELOPMENT, HELD_OUT } from "./corpus"

describe("the evaluation split is a split", () => {
  test("no held-out excerpt appears in the development set", () => {
    const dev = new Set(DEVELOPMENT.flatMap((item) => item.input.provenance.map((entry) => entry.excerpt)))
    for (const item of HELD_OUT) for (const entry of item.input.provenance) expect(dev.has(entry.excerpt)).toBe(false)
  })

  test("ids are unique across both sets", () => {
    const ids = [...DEVELOPMENT, ...HELD_OUT].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("both sets carry positives and hard negatives", () => {
    for (const set of [DEVELOPMENT, HELD_OUT]) {
      expect(set.some((item) => item.expect === "escalate")).toBe(true)
      expect(set.filter((item) => item.expect === "quiet").length).toBeGreaterThan(2)
    }
  })

  test("the held-out set covers every carrier the brief names", () => {
    const groups: string[] = HELD_OUT.map((item) => item.group)
    for (const required of [
      "readme",
      "skill",
      "dependency",
      "web",
      "mcp",
      "source-comment",
      "ci-config",
      "notebook",
      "laundering",
      "goal-mismatch",
      "benign-carrier",
      "benign-network",
      "benign-secret-task",
      "benign-coding",
    ])
      expect(groups).toContain(required)
  })
})

// Deliberately no assertions on HELD_OUT scores. Asserting a metric on held-out data makes it a
// validation set consumed on every commit, and turns any failing edit into a channel from held-out
// labels back into the provider — the exact thing the split exists to prevent. The scores are
// reported by `script/security-semantic-eval.ts` and read by a person.
