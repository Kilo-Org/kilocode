/**
 * Sara RLM — Scheduler Tests
 *
 * Tests: DAG → wave scheduling with Kahn's algorithm.
 * Pure unit tests — no Effect runtime.
 */

import { schedule } from "../../src/rlm/scheduler.js"
import type { RLMChildSpec } from "../../src/rlm/planner/schema.js"

function mk(overrides: Partial<RLMChildSpec> = {}): RLMChildSpec {
  return {
    description: overrides.description ?? `T`,
    prompt: overrides.prompt ?? `Do`,
    parallelizable: overrides.parallelizable ?? true,
    dependsOn: overrides.dependsOn ?? [],
  }
}

test("single child → single wave", () => {
  const waves = schedule([mk()])
  expect(waves.length).toBe(1)
  expect(waves[0].children).toEqual([0])
})

test("two independent tasks → single wave", () => {
  const waves = schedule([mk({ description: "A" }), mk({ description: "B" })])
  expect(waves.length).toBe(1)
  expect(waves[0].children.sort()).toEqual([0, 1])
})

test("linear chain A→B→C → three waves", () => {
  const waves = schedule([
    mk({ description: "A" }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [1] }),
  ])
  expect(waves.length).toBe(3)
  expect(waves[0].children).toEqual([0])
  expect(waves[1].children).toEqual([1])
  expect(waves[2].children).toEqual([2])
})

test("diamond A→(B,C), B+C→D → three waves", () => {
  const waves = schedule([
    mk({ description: "A" }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [0] }),
    mk({ description: "D", dependsOn: [1, 2] }),
  ])
  expect(waves.length).toBe(3)
  expect(waves[0].children.sort()).toEqual([0])
  expect(waves[1].children.sort()).toEqual([1, 2])
  expect(waves[2].children.sort()).toEqual([3])
})

test("empty children → empty waves", () => {
  const waves = schedule([])
  expect(waves.length).toBe(0)
})

test("two parallel chains → two waves", () => {
  // A→C and B→C
  const waves = schedule([
    mk({ description: "A" }),
    mk({ description: "B" }),
    mk({ description: "C", dependsOn: [0, 1] }),
  ])
  expect(waves.length).toBe(2)
  expect(waves[0].children.sort()).toEqual([0, 1])
  expect(waves[1].children.sort()).toEqual([2])
})

test("complex multi-wave DAG", () => {
  // A→B, A→C, B→D, C→D, D→E
  const waves = schedule([
    mk({ description: "A" }),
    mk({ description: "B", dependsOn: [0] }),
    mk({ description: "C", dependsOn: [0] }),
    mk({ description: "D", dependsOn: [1, 2] }),
    mk({ description: "E", dependsOn: [3] }),
  ])
  expect(waves.length).toBe(4)
  expect(waves[0].children).toEqual([0])
  expect(waves[1].children.sort()).toEqual([1, 2])
  expect(waves[2].children).toEqual([3])
  expect(waves[3].children).toEqual([4])
})