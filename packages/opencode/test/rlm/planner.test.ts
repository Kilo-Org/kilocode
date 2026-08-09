/**
 * Sara RLM — Planner Tests
 *
 * Tests: schema validation, cycle detection, dependency checks.
 * These are pure unit tests — no LLM calls, no Effect runtime needed.
 */

import { validateDecomposePlan } from "../../src/rlm/planner/schema.js"
import type { RLMChildSpec } from "../../src/rlm/planner/schema.js"

function mk(overrides: Partial<RLMChildSpec> = {}): RLMChildSpec {
  return {
    description: overrides.description ?? `Task description`,
    prompt: overrides.prompt ?? `Do this task`,
    parallelizable: overrides.parallelizable ?? true,
    dependsOn: overrides.dependsOn ?? [],
  }
}

// --- Valid Plans ---

test("valid execute plan is always valid", () => {
  // An execute plan has no children to validate
  // validateDecomposePlan is only called for decompose plans
  const children: RLMChildSpec[] = [mk()]
  expect(validateDecomposePlan(children).length).toBe(0)
})

test("valid decompose with parallel children", () => {
  const children: RLMChildSpec[] = [mk({ description: "A" }), mk({ description: "B" })]
  expect(validateDecomposePlan(children).length).toBe(0)
})

test("valid linear DAG (A → B → C)", () => {
  const children: RLMChildSpec[] = [
    mk({ description: "A" }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [1] }),
  ]
  expect(validateDecomposePlan(children).length).toBe(0)
})

test("valid diamond DAG", () => {
  // A → B, A → C, B+C → D
  const children: RLMChildSpec[] = [
    mk({ description: "A" }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [0] }),
    mk({ description: "D", dependsOn: [1, 2] }),
  ]
  expect(validateDecomposePlan(children).length).toBe(0)
})

// --- Invalid Plans ---

test("empty children fails", () => {
  expect(validateDecomposePlan([]).length).toBeGreaterThan(0)
})

test("too many children fails", () => {
  const children: RLMChildSpec[] = Array.from({ length: 51 }, (_, i) => mk({ description: `T${i}` }))
  expect(validateDecomposePlan(children).length).toBeGreaterThan(0)
})

test("empty description fails", () => {
  const children: RLMChildSpec[] = [mk({ description: "" })]
  expect(validateDecomposePlan(children).length).toBeGreaterThan(0)
})

test("empty prompt fails", () => {
  const children: RLMChildSpec[] = [mk({ prompt: "" })]
  expect(validateDecomposePlan(children).length).toBeGreaterThan(0)
})

test("out-of-bounds dependency fails", () => {
  const children: RLMChildSpec[] = [mk({ dependsOn: [5] })]
  const errors = validateDecomposePlan(children)
  expect(errors.length).toBeGreaterThan(0)
  expect(errors.some((e) => e.message.includes("out of bounds"))).toBe(true)
})

test("self-dependency fails", () => {
  const children: RLMChildSpec[] = [mk({ dependsOn: [0] })]
  const errors = validateDecomposePlan(children)
  expect(errors.length).toBeGreaterThan(0)
  expect(errors.some((e) => e.message.includes("Self-dependency"))).toBe(true)
})

test("simple cycle fails (A↔B)", () => {
  const children: RLMChildSpec[] = [
    mk({ description: "A", dependsOn: [1] }),
    mk({ description: "B", dependsOn: [0] }),
  ]
  const errors = validateDecomposePlan(children)
  expect(errors.some((e) => e.message.includes("cycle"))).toBe(true)
})

test("three-node cycle fails (A→B→C→A)", () => {
  const children: RLMChildSpec[] = [
    mk({ description: "A", dependsOn: [2] }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [1] }),
  ]
  const errors = validateDecomposePlan(children)
  expect(errors.some((e) => e.message.includes("cycle"))).toBe(true)
})

test("invalid dependency index (negative)", () => {
  const children: RLMChildSpec[] = [mk({ dependsOn: [-1] })]
  expect(validateDecomposePlan(children).length).toBeGreaterThan(0)
})