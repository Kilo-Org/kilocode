import { WorkflowStateManager } from "./state"
import type { WorkflowStage, WorkflowState } from "./types"

const STAGE_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  plan: ["challenge"],
  challenge: ["plan", "contract"],
  contract: ["challenge", "build"],
  build: ["review"],
  review: ["build", "ship"],
  ship: ["retro"],
  retro: ["plan"],
}

export type WorkflowAction = "next" | "approve" | "revise"

const ACTION_TRANSITIONS: Record<Exclude<WorkflowAction, "next">, Partial<Record<WorkflowStage, WorkflowStage>>> = {
  approve: {
    challenge: "contract",
    contract: "build",
    review: "ship",
  },
  revise: {
    challenge: "plan",
    contract: "challenge",
    review: "build",
  },
} satisfies Record<string, Partial<Record<WorkflowStage, WorkflowStage>>>

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

  export function resolveAction(stage: WorkflowStage, action: WorkflowAction): WorkflowStage | undefined {
    if (action === "next") return nextStage(stage)
    return ACTION_TRANSITIONS[action][stage]
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
    const reset = targetStage === "plan" || (targetStage === "build" && state.currentStage === "contract")
    const newState: WorkflowState = {
      ...state,
      currentPhase: state.currentStage === "retro" && targetStage === "plan" ? "" : state.currentPhase,
      currentStage: targetStage,
      activeWave: reset ? undefined : state.activeWave,
      totalWaves: reset ? undefined : state.totalWaves,
      activeTasks: reset ? [] : state.activeTasks,
      lastUpdated: new Date().toISOString(),
    }
    await manager.writeState(newState)
    return newState
  }

  export function createManager(basePath: string): WorkflowStateManager {
    return new WorkflowStateManager(basePath)
  }
}
