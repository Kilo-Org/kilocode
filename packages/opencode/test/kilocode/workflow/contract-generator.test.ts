import { describe, it, expect } from "bun:test"
import type { PlanTask } from "@/devilcode/workflow/types"
import { generateContracts } from "@/devilcode/workflow/contract-generator"

function makeTasks(overrides: Partial<PlanTask>[]): PlanTask[] {
  return overrides.map((o, i) => ({
    id: o.id ?? `task-${i + 1}`,
    title: o.title ?? `Task ${i + 1}`,
    role: o.role ?? "worker",
    wave: o.wave ?? 1,
    dependsOn: o.dependsOn ?? [],
    estimatedComplexity: o.estimatedComplexity ?? "medium",
    files: o.files ?? [],
    verification: o.verification ?? [],
    description: o.description ?? "",
  }))
}

describe("generateContracts", () => {
  it("returns empty contract set when no tasks share files", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/a.ts"] },
      { id: "t2", files: ["src/b.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.apiContracts).toEqual([])
    expect(result.typeContracts).toEqual([])
    expect(result.integrationHints).toEqual([])
  })

  it("detects shared file as a type contract", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/types.ts", "src/a.ts"] },
      { id: "t2", files: ["src/types.ts", "src/b.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.typeContracts.length).toBeGreaterThanOrEqual(1)
    const shared = result.typeContracts.find((c) => c.name.includes("types"))
    expect(shared).toBeDefined()
    expect(shared!.usedByTasks).toContain("t1")
    expect(shared!.usedByTasks).toContain("t2")
  })

  it("generates integration hint for cross-wave dependency", () => {
    const tasks = makeTasks([
      { id: "t1", wave: 1, files: ["src/api/users.ts"] },
      { id: "t2", wave: 2, dependsOn: ["t1"], files: ["src/api/auth.ts"] },
    ])
    const result = generateContracts(tasks)
    expect(result.integrationHints.length).toBeGreaterThanOrEqual(1)
    const hint = result.integrationHints[0]
    expect(hint.producerTaskId).toBe("t1")
    expect(hint.consumerTaskIds).toContain("t2")
    expect(hint.interfaceType).toBe("file_import")
  })

  it("handles tasks with no files gracefully", () => {
    const tasks = makeTasks([
      { id: "t1", files: [] },
      { id: "t2", files: [] },
    ])
    const result = generateContracts(tasks)
    expect(result.apiContracts).toEqual([])
    expect(result.typeContracts).toEqual([])
  })

  it("validates task refs in generated contracts", () => {
    const tasks = makeTasks([
      { id: "t1", files: ["src/shared.ts"] },
      { id: "t2", files: ["src/shared.ts"] },
    ])
    const result = generateContracts(tasks)
    const validIds = new Set(tasks.map((t) => t.id))
    for (const tc of result.typeContracts) {
      for (const taskId of tc.usedByTasks) {
        expect(validIds.has(taskId)).toBe(true)
      }
    }
  })
})
