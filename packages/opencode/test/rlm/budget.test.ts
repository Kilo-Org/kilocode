/**
 * Sara RLM — Budget Tests
 *
 * Tests: flat budget, hierarchical allocation, equal share, upward propagation.
 * Pure unit tests — no Effect runtime.
 */

import { RLMBudget } from "../../src/rlm/budget/budget.js"
import { computeUsage } from "../../src/rlm/result.js"

test("root budget with positive limit", () => {
  const budget = new RLMBudget(100)
  expect(budget.enabled).toBe(true)
  expect(budget.maxTokens).toBe(100)
  expect(budget.remaining).toBe(100)
})

test("root budget with zero limit is disabled", () => {
  const budget = new RLMBudget(0)
  expect(budget.enabled).toBe(false)
})

test("check within budget returns null", () => {
  const budget = new RLMBudget(100)
  expect(budget.check(50)).toBeNull()
})

test("check at budget limit returns null", () => {
  const budget = new RLMBudget(100)
  expect(budget.check(100)).toBeNull()
})

test("check exceeding budget returns error", () => {
  const budget = new RLMBudget(100)
  budget.spend(computeUsage({ input: 90, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }))
  expect(budget.check(20)).not.toBeNull()
})

test("disabled budget never blocks", () => {
  const budget = new RLMBudget(0)
  expect(budget.check(999999)).toBeNull()
})

test("spend increases usage", () => {
  const budget = new RLMBudget(200)
  budget.spend(computeUsage({ input: 30, output: 20, reasoning: 5, cache: { read: 0, write: 0 } }))
  expect(budget.used.total).toBe(55)
  expect(budget.remaining).toBe(145)
})

test("deriveChild creates bounded child", () => {
  const root = new RLMBudget(100)
  const child = root.deriveChild(40)
  expect(child.maxTokens).toBe(40)
  expect(child.enabled).toBe(true)
})

test("deriveChild cannot exceed parent remaining", () => {
  const root = new RLMBudget(100)
  root.spend(computeUsage({ input: 80, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }))
  const child = root.deriveChild(100)
  expect(child.maxTokens).toBe(20) // capped to remaining
})

test("deriveEqualShare splits evenly", () => {
  const root = new RLMBudget(100)
  const children = [root.deriveEqualShare(4), root.deriveEqualShare(4), root.deriveEqualShare(4), root.deriveEqualShare(4)]
  // Each gets 25 (100/4)
  expect(children[0].maxTokens).toBe(25)
  expect(children[1].maxTokens).toBe(25)
  expect(children[2].maxTokens).toBe(25)
  expect(children[3].maxTokens).toBe(25)
})

test("child spend propagates upward", () => {
  const root = new RLMBudget(100)
  const child = root.deriveChild(50)
  child.spend(computeUsage({ input: 30, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }))
  expect(root.used.total).toBe(30) // propagated upward
  expect(child.used.total).toBe(30)
})

test("nested hierarchy enforces limits", () => {
  const root = new RLMBudget(100)
  const child = root.deriveChild(50)
  const grandchild = child.deriveChild(30)

  // Grandchild within its limit
  expect(grandchild.check(30)).toBeNull()

  // Grandchild cannot exceed its allocation
  expect(grandchild.check(31)).not.toBeNull()

  // Grandchild spend propagates to child and root
  grandchild.spend(computeUsage({ input: 20, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }))
  expect(grandchild.used.total).toBe(20)
  expect(child.used.total).toBe(20)
  expect(root.used.total).toBe(20)
})