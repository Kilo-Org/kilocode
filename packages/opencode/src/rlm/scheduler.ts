/**
 * Sara RLM — Scheduler (Phase 2)
 *
 * Converts a validated dependency graph into ordered execution waves.
 * Tasks in the same wave have no mutual dependencies and may run concurrently.
 */

import type { RLMChildSpec } from "./planner/schema.js"

export interface ScheduleWave {
  /** Zero-based wave index. */
  readonly index: number
  /** Sibling indices in this wave (original planner order). */
  readonly children: readonly number[]
}

/**
 * Produce topologically sorted waves from a set of child specs.
 *
 * Algorithm:
 * 1. Compute in-degree for each child.
 * 2. Start with all children with in-degree 0 → Wave 0.
 * 3. For each child in the current wave, decrement the in-degree of all
 *    children that depend on it. Any that reach 0 go into the next wave.
 * 4. Repeat until all children are assigned.
 *
 * Precondition: children must be pre-validated (no cycles, valid indices).
 */
export function schedule(children: readonly RLMChildSpec[]): ScheduleWave[] {
  const n = children.length

  // Base case: single child
  if (n <= 1) {
    return n === 0 ? [] : [{ index: 0, children: [0] }]
  }

  // Compute in-degree (number of dependencies each child has)
  const inDegree = new Array<number>(n).fill(0)
  for (const child of children) {
    for (const dep of child.dependsOn) {
      inDegree[dep] = (inDegree[dep] ?? 0) + 0 // counts how many children depend ON this sibling
    }
  }

  // Actually, in-degree for wave ordering means: how many of my dependencies are unfinished.
  // Initial in-degree = dependsOn.length for each child.
  // When a dependency completes, in-degree[me]--.
  const remaining = children.map((c) => c.dependsOn.length)

  // For reverse mapping: which children depend on a given child?
  const dependents: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (const dep of children[i].dependsOn) {
      dependents[dep].push(i)
    }
  }

  // Start wave with all children that have in-degree 0
  const waves: ScheduleWave[] = []
  const assigned = new Set<number>()
  let waveIndex = 0

  let ready: number[] = []
  for (let i = 0; i < n; i++) {
    if (remaining[i] === 0) ready.push(i)
  }

  while (ready.length > 0) {
    waves.push({ index: waveIndex, children: [...ready].sort((a, b) => a - b) })

    for (const r of ready) assigned.add(r)

    const nextReady: number[] = []
    for (const completed of ready) {
      for (const dep of dependents[completed]) {
        remaining[dep]--
        if (remaining[dep] === 0 && !assigned.has(dep)) {
          nextReady.push(dep)
        }
      }
    }

    ready = nextReady
    waveIndex++
  }

  // Sanity check: all children must be assigned
  if (assigned.size !== n) {
    // Should not happen after cycle validation, but guard anyway
    return []
  }

  return waves
}