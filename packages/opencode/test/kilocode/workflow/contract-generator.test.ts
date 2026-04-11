import { describe, it, expect } from "bun:test"
import { generateContracts } from "@/devilcode/workflow/contract-generator"
import type { PlanTask } from "@/devilcode/workflow/types"

describe("contract generator", () => {
  describe("generateContracts", () => {
    it("generates empty contracts for empty tasks", () => {
      const result = generateContracts([])
      expect(result.typeContracts).toEqual([])
      expect(result.apiContracts).toEqual([])
      expect(result.integrationHints).toEqual([])
    })

    it("detects shared files between tasks", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task",
          files: ["src/shared.ts", "src/file1.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
        {
          id: "task-2",
          title: "Task 2",
          description: "Second task",
          files: ["src/shared.ts", "src/file2.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)

      expect(result.typeContracts).toHaveLength(1)
      expect(result.typeContracts[0].name).toBe("shared")
      expect(result.typeContracts[0].usedByTasks).toContain("task-1")
      expect(result.typeContracts[0].usedByTasks).toContain("task-2")
    })

    it("does not create contracts for files used by single task", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task",
          files: ["src/unique.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)
      expect(result.typeContracts).toHaveLength(0)
    })

    it("detects cross-wave dependencies", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Producer",
          description: "Produces output",
          files: ["src/producer.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "high",
          verification: [],
        },
        {
          id: "task-2",
          title: "Consumer",
          description: "Consumes output",
          files: ["src/consumer.ts"],
          dependsOn: ["task-1"],
          wave: 1,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)

      expect(result.integrationHints).toHaveLength(1)
      expect(result.integrationHints[0].producerTaskId).toBe("task-1")
      expect(result.integrationHints[0].consumerTaskIds).toContain("task-2")
      expect(result.integrationHints[0].interfaceType).toBe("file_import")
    })

    it("handles multiple shared files", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Task 1",
          description: "First task",
          files: ["src/shared1.ts", "src/shared2.ts", "src/unique1.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
        {
          id: "task-2",
          title: "Task 2",
          description: "Second task",
          files: ["src/shared1.ts", "src/shared2.ts", "src/unique2.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
        {
          id: "task-3",
          title: "Task 3",
          description: "Third task",
          files: ["src/shared1.ts", "src/unique3.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)

      // shared1.ts is used by all 3 tasks
      // shared2.ts is used by task-1 and task-2
      expect(result.typeContracts).toHaveLength(2)
    })

    it("handles complex dependency chains", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Base",
          description: "Base task",
          files: ["src/base.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "low",
          verification: [],
        },
        {
          id: "task-2",
          title: "Layer 1",
          description: "Depends on base",
          files: ["src/layer1.ts"],
          dependsOn: ["task-1"],
          wave: 1,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
        {
          id: "task-3",
          title: "Layer 2a",
          description: "Depends on layer 1",
          files: ["src/layer2a.ts"],
          dependsOn: ["task-2"],
          wave: 2,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
        {
          id: "task-4",
          title: "Layer 2b",
          description: "Also depends on layer 1",
          files: ["src/layer2b.ts"],
          dependsOn: ["task-2"],
          wave: 2,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)

      // Should detect 2 cross-wave dependencies: task-1->task-2, task-2->[task-3, task-4]
      expect(result.integrationHints).toHaveLength(2)
    })

    it("handles missing dependencies gracefully", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "Task 1",
          description: "Task with missing dep",
          files: ["src/file.ts"],
          dependsOn: ["nonexistent"],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)
      // Should not throw, just have no hints
      expect(result.integrationHints).toHaveLength(0)
    })

    it("generates proper contract descriptions", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "API Task",
          description: "API implementation",
          files: ["src/api.ts", "src/types.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "high",
          verification: [],
        },
        {
          id: "task-2",
          title: "Consumer Task",
          description: "Uses API",
          files: ["src/api.ts", "src/consumer.ts"],
          dependsOn: [],
          wave: 0,
          role: "worker",
          estimatedComplexity: "medium",
          verification: [],
        },
      ]

      const result = generateContracts(tasks)

      expect(result.typeContracts[0].name).toBe("api")
      expect(result.typeContracts[0].description).toContain("src/api.ts")
      expect(result.typeContracts[0].description).toContain("task-1")
      expect(result.typeContracts[0].description).toContain("task-2")
    })
  })
})
