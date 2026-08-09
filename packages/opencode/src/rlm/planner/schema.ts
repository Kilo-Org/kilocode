/**
 * Sara RLM — Planner Schema (Phase 2)
 *
 * Structured output types for the RLM planner.
 * All planner LLM calls produce a schema-validated RLMPlan.
 */

import type { RLMTaskID } from "../task.js"

// --- RLMChildSpec ---
// Planner output: describes one child task to be created.

export interface RLMChildSpec {
  /**
   * Short human-readable label (3-7 words).
   * Must be non-empty and <= 200 characters.
   */
  readonly description: string

  /**
   * The concrete instruction for the child agent.
   * Must be non-empty.
   */
  readonly prompt: string

  /**
   * Whether this child may run concurrently with siblings
   * that have no dependency relationship.
   */
  readonly parallelizable: boolean

  /**
   * Zero-based indices of sibling children that must complete
   * before this child can start. Resolved to RLMTaskIDs by the runtime.
   */
  readonly dependsOn: readonly number[]
}

// --- RLMPlan ---
// Structured planner output.

export type RLMPlan =
  | {
      readonly strategy: "execute"
      /**
       * Optional: light reasoning about why this task does not need decomposition.
       */
      readonly rationale?: string
    }
  | {
      readonly strategy: "decompose"
      readonly children: readonly RLMChildSpec[]
      /**
       * Explanation of the decomposition strategy.
       */
      readonly rationale?: string
    }

// --- Validation ---

export interface PlanValidationError {
  readonly message: string
  readonly index?: number
}

/**
 * Validate a decompose plan.
 * Returns an empty array if valid, or a list of validation errors.
 */
export function validateDecomposePlan(children: readonly RLMChildSpec[]): PlanValidationError[] {
  const errors: PlanValidationError[] = []

  if (!children || children.length === 0) {
    errors.push({ message: "Decompose strategy must have at least 1 child" })
    return errors
  }

  if (children.length > 50) {
    errors.push({ message: `Too many children: ${children.length} (max 50)` })
    return errors
  }

  const n = children.length

  for (let i = 0; i < n; i++) {
    const child = children[i]

    // Validate description
    if (!child.description || child.description.trim().length === 0) {
      errors.push({ message: "Child description must be non-empty", index: i })
    } else if (child.description.length > 200) {
      errors.push({ message: `Child description too long: ${child.description.length} chars (max 200)`, index: i })
    }

    // Validate prompt
    if (!child.prompt || child.prompt.trim().length === 0) {
      errors.push({ message: "Child prompt must be non-empty", index: i })
    }

    // Validate dependsOn
    for (const dep of child.dependsOn) {
      if (typeof dep !== "number" || !Number.isInteger(dep) || dep < 0) {
        errors.push({ message: `Invalid dependency index: ${dep}`, index: i })
        continue
      }
      if (dep >= n) {
        errors.push({ message: `Dependency index ${dep} out of bounds (${n} children)`, index: i })
      }
      if (dep === i) {
        errors.push({ message: `Self-dependency: child ${i} depends on itself`, index: i })
      }
    }
  }

  // Cycle detection via DFS coloring
  if (errors.length === 0 && hasCycle(children)) {
    errors.push({ message: "Dependency graph contains a cycle" })
  }

  return errors
}

/**
 * Cycle detection using DFS with 3-color marking.
 * 0 = white (unvisited), 1 = gray (in current DFS path), 2 = black (done)
 */
function hasCycle(children: readonly RLMChildSpec[]): boolean {
  const n = children.length
  const color = new Array(n).fill(0)

  function dfs(node: number): boolean {
    color[node] = 1 // gray — in current path
    for (const dep of children[node].dependsOn) {
      if (color[dep] === 1) return true  // back edge → cycle
      if (color[dep] === 0 && dfs(dep)) return true
    }
    color[node] = 2 // black — done
    return false
  }

  for (let i = 0; i < n; i++) {
    if (color[i] === 0 && dfs(i)) return true
  }
  return false
}