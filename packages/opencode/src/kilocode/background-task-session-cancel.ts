// kilocode_change - new file
import { SessionPrompt } from "@/session/prompt"
import { BackgroundTask } from "./background-task"
import { BackgroundTaskCancel } from "./background-task-cancel"

export namespace BackgroundTaskSessionCancel {
  export function cancel(claim: BackgroundTask.Claim): Promise<BackgroundTask.TransitionResult> {
    return BackgroundTaskCancel.cancel({
      claim,
      cancelChild: (childSessionID) => SessionPrompt.cancel(childSessionID),
    })
  }
}
