import path from "path"
import type { PlanTask } from "./types"
import type { ContractSet, TypeContract, IntegrationHint } from "./contracts"

/**
 * Generates a ContractSet from PlanTask[] using heuristic analysis:
 * - Shared files between tasks → TypeContract
 * - Cross-wave dependencies → IntegrationHint
 */
export function generateContracts(tasks: PlanTask[]): ContractSet {
  const typeContracts = detectSharedFiles(tasks)
  const integrationHints = detectCrossWaveDeps(tasks)

  return {
    apiContracts: [],
    typeContracts,
    integrationHints,
  }
}

function detectSharedFiles(tasks: PlanTask[]): TypeContract[] {
  const fileToTasks = new Map<string, string[]>()
  for (const task of tasks) {
    for (const file of task.files) {
      const existing = fileToTasks.get(file) ?? []
      existing.push(task.id)
      fileToTasks.set(file, existing)
    }
  }

  const contracts: TypeContract[] = []
  for (const [file, taskIds] of fileToTasks) {
    if (taskIds.length < 2) continue

    const basename = path.basename(file, path.extname(file))
    contracts.push({
      name: basename,
      description: `Shared file: ${file} — modified by tasks ${taskIds.join(", ")}`,
      fieldSpecs: [],
      usedByTasks: taskIds,
    })
  }

  return contracts
}

function detectCrossWaveDeps(tasks: PlanTask[]): IntegrationHint[] {
  const producerToConsumers = new Map<string, Set<string>>()
  const taskMap = new Map<string, PlanTask>()
  for (const task of tasks) {
    taskMap.set(task.id, task)
  }

  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      const dep = taskMap.get(depId)
      if (!dep) continue
      if (dep.wave >= task.wave) continue

      const consumers = producerToConsumers.get(depId) ?? new Set()
      consumers.add(task.id)
      producerToConsumers.set(depId, consumers)
    }
  }

  const hints: IntegrationHint[] = []
  for (const [producerId, consumerIds] of producerToConsumers) {
    const producer = taskMap.get(producerId)!
    const consumers = [...consumerIds]
    hints.push({
      interfaceType: "file_import",
      producerTaskId: producerId,
      consumerTaskIds: consumers,
      description: `Task "${producer.title}" produces output consumed by tasks ${consumers.join(", ")}`,
      endpointHints: [],
    })
  }

  return hints
}
