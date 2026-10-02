// Session metadata as clients see it: each Kilo runtime projection applied on
// every session read and update.
import { GoalState } from "@/kilocode/session/goal/state"
import { KiloTaskPauseState } from "@/kilocode/tool/task-pause-state"

export function project(id: string, metadata?: Record<string, unknown> | null) {
  return KiloTaskPauseState.project(id, GoalState.project(id, metadata))
}

export * as KiloSessionMetadata from "./metadata"
