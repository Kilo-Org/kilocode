import type { PlanTask } from "./types"

export function groupByWave(tasks: PlanTask[]): Map<number, PlanTask[]> {
  const waves = new Map<number, PlanTask[]>()
  for (const task of tasks) {
    const existing = waves.get(task.wave) ?? []
    existing.push(task)
    waves.set(task.wave, existing)
  }
  return new Map([...waves.entries()].sort(([a], [b]) => a - b))
}

export function validateWaveIntegrity(tasks: PlanTask[]): string[] {
  const errors: string[] = []
  const taskWaveMap = new Map<string, number>()
  for (const task of tasks) {
    taskWaveMap.set(task.id, task.wave)
  }
  for (const task of tasks) {
    for (const depId of task.dependsOn) {
      const depWave = taskWaveMap.get(depId)
      if (depWave === undefined) {
        errors.push(`Task ${task.id} depends on unknown task ${depId}`)
        continue
      }
      if (depWave >= task.wave) {
        errors.push(
          `Task ${task.id} (wave ${task.wave}) depends on task ${depId} (wave ${depWave}) — dependency must be in an earlier wave`,
        )
      }
    }
  }
  return errors
}

export function detectFileConflicts(tasks: PlanTask[]): string[] {
  const conflicts: string[] = []
  const waves = groupByWave(tasks)
  for (const [waveNum, waveTasks] of waves) {
    const fileOwners = new Map<string, string[]>()
    for (const task of waveTasks) {
      for (const file of task.files) {
        const owners = fileOwners.get(file) ?? []
        owners.push(task.id)
        fileOwners.set(file, owners)
      }
    }
    for (const [file, owners] of fileOwners) {
      if (owners.length > 1) {
        conflicts.push(`Wave ${waveNum}: file "${file}" modified by tasks ${owners.join(", ")}`)
      }
    }
  }
  return conflicts
}
