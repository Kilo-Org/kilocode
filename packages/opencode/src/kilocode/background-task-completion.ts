// kilocode_change - new file
import type { MessageID } from "@/session/schema"
import { BackgroundTask } from "./background-task"

export namespace BackgroundTaskCompletion {
  export interface Input {
    claim: BackgroundTask.Claim
    completion: Promise<{ resultMessageID: MessageID }>
  }

  export function observe(input: Input): Promise<BackgroundTask.TransitionResult> {
    return input.completion.then(
      ({ resultMessageID }) =>
        BackgroundTask.transitionToCompleted({
          ...input.claim,
          resultMessageID,
        }),
      (error) =>
        BackgroundTask.transitionToFailed({
          ...input.claim,
          error,
        }),
    )
  }
}
