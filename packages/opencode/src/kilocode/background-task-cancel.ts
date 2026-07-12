// kilocode_change - new file
import type { SessionID } from "@/session/schema"
import { BackgroundTask } from "./background-task"

export namespace BackgroundTaskCancel {
  export interface Input {
    claim: BackgroundTask.Claim
    cancelChild: (childSessionID: SessionID) => void | Promise<void>
  }

  export async function cancel(input: Input): Promise<BackgroundTask.TransitionResult> {
    const transition = BackgroundTask.transitionToCancelled(input.claim)

    if (!transition.applied) {
      return transition
    }

    if (!transition.info || transition.info.status !== "cancelled") {
      throw new Error("Background task failed to enter cancelled state")
    }

    const childSID: SessionID = transition.info.childSessionID
    await input.cancelChild(childSID)

    return transition
  }
}
