import { describe, expect, test } from "bun:test"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "@/devilcode/workflow/executor"
import type { PlanTask } from "@/devilcode/workflow/types"

const tasks: PlanTask[] = [
  { id: "01-01", title: "A", role: "senior", wave: 1, dependsOn: [], estimatedComplexity: "high", files: ["src/a.ts"], verification: [], description: "Task A" },
  { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "low", files: ["src/b.ts"], verification: [], description: "Task B" },
  { id: "01-03", title: "C", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "low", files: ["src/c.ts"], verification: [], description: "Task C" },
  { id: "01-04", title: "D", role: "senior", wave: 2, dependsOn: ["01-01"], estimatedComplexity: "high", files: ["src/d.ts", "src/a.ts"], verification: [], description: "Task D" },
  { id: "01-05", title: "E", role: "worker", wave: 2, dependsOn: ["01-02"], estimatedComplexity: "low", files: ["src/e.ts"], verification: [], description: "Task E" },
]

describe("groupByWave", () => {
  test("groups tasks into ordered waves", () => {
    const waves = groupByWave(tasks)
    expect(waves.size).toBe(2)
    expect(waves.get(1)!.length).toBe(3)
    expect(waves.get(2)!.length).toBe(2)
  })
  test("wave 1 tasks have no dependencies", () => {
    const waves = groupByWave(tasks)
    for (const task of waves.get(1)!) {
      expect(task.dependsOn.length).toBe(0)
    }
  })
  test("returns empty map for empty task list", () => {
    expect(groupByWave([]).size).toBe(0)
  })
})

describe("validateWaveIntegrity", () => {
  test("passes for valid wave structure", () => {
    expect(validateWaveIntegrity(tasks)).toEqual([])
  })
  test("detects dependency on later wave", () => {
    const bad: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: ["01-02"], estimatedComplexity: "medium", files: [], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 2, dependsOn: [], estimatedComplexity: "medium", files: [], verification: [], description: "B" },
    ]
    const errors = validateWaveIntegrity(bad)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain("01-01")
  })
  test("detects dependency within same wave", () => {
    const bad: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: ["01-02"], estimatedComplexity: "medium", files: [], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: [], verification: [], description: "B" },
    ]
    expect(validateWaveIntegrity(bad).length).toBeGreaterThan(0)
  })
})

describe("detectFileConflicts", () => {
  test("no conflicts when files are disjoint within waves", () => {
    expect(detectFileConflicts(tasks)).toEqual([])
  })
  test("detects file conflict within a wave", () => {
    const conflicting: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "B" },
    ]
    const conflicts = detectFileConflicts(conflicting)
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]).toContain("src/shared.ts")
  })
  test("allows same file across different waves", () => {
    const valid: PlanTask[] = [
      { id: "01-01", title: "A", role: "worker", wave: 1, dependsOn: [], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "A" },
      { id: "01-02", title: "B", role: "worker", wave: 2, dependsOn: ["01-01"], estimatedComplexity: "medium", files: ["src/shared.ts"], verification: [], description: "B" },
    ]
    expect(detectFileConflicts(valid)).toEqual([])
  })
})
