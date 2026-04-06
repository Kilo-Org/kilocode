import { WorkflowStateManager } from "./state"
import type { WorkflowStage, WorkflowState } from "./types"

const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  plan: ["challenge"],
  challenge: ["plan", "build"],
  build: ["review"],
  review: ["build", "ship"],
  ship: ["retro"],
  retro: ["plan"],
}

export namespace Workflow {
  export function canTransition(from: WorkflowStage, to: WorkflowStage): boolean {
    return STAGE_TRANSITIONS[from]?.includes(to) ?? false
  }

  export function nextStage(current: WorkflowStage): WorkflowStage {
    const transitions = STAGE_TRANSITIONS[current]
    if (!transitions || transitions.length === 0) {
      throw new Error(`No transitions available from stage "${current}"`)
    }
    return transitions[0]
  }

  export async function advanceStage(
    manager: WorkflowStateManager,
    targetStage: WorkflowStage,
  ): Promise<WorkflowState> {
    const state = await manager.readState()
    if (!canTransition(state.currentStage, targetStage)) {
      throw new Error(
        `Cannot transition from "${state.currentStage}" to "${targetStage}". Valid transitions: ${STAGE_TRANSITIONS[state.currentStage]?.join(", ")}`,
      )
    }
    const newState: WorkflowState = {
      ...state,
      currentStage: targetStage,
      activeTasks: [],
      lastUpdated: new Date().toISOString(),
    }
    await manager.writeState(newState)
    return newState
  }

  export function createManager(basePath: string): WorkflowStateManager {
    return new WorkflowStateManager(basePath)
  }
}
