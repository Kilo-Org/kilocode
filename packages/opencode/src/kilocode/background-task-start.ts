// kilocode_change - new file
import type { MessageID, SessionID } from "@/session/schema"
import { BackgroundTask } from "./background-task"
import { BackgroundTaskStartAck } from "./background-task-start-ack"

export namespace BackgroundTaskStart {
  export interface Input {
    parentSessionID: SessionID
    childSessionID: SessionID
    childUserMessageID: MessageID
    launch: () => void
  }

  export interface Result {
    info: BackgroundTask.Info
    claim: BackgroundTask.Claim
  }

  export async function start(input: Input): Promise<Result> {
    const created = BackgroundTask.create({
      parentSessionID: input.parentSessionID,
      childSessionID: input.childSessionID,
      childUserMessageID: input.childUserMessageID,
    })

    const controller = new AbortController()

    const ack = BackgroundTaskStartAck.wait({
      sessionID: input.childSessionID,
      signal: controller.signal,
    })

    try {
      input.launch()
    } catch (err) {
      controller.abort()
      await ack.catch(() => {})
      BackgroundTask.transitionToFailed({
        ...created.claim,
        error: err,
      })
      throw err
    }

    await ack

    const running = BackgroundTask.transitionToRunning(created.claim)
    if (!running.applied || !running.info || running.info.status !== "running") {
      throw new Error("Background task failed to enter running state")
    }

    return { info: running.info, claim: created.claim }
  }
}
