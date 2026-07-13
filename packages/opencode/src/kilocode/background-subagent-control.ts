// kilocode_change - new file
import { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import { BackgroundSubagentStart } from "./background-subagent-start"
import { BackgroundTask } from "./background-task"
import { BackgroundTaskSessionCancel } from "./background-task-session-cancel"

export namespace BackgroundSubagentControl {
  export interface HandleInput {
    parentSessionID: SessionID
    taskID: BackgroundTask.TaskID
  }

  export interface ResultView {
    info: BackgroundTask.Info
    message: MessageV2.WithParts | undefined
  }

  const claims = new Map<BackgroundTask.TaskID, BackgroundTask.Claim>()

  export async function start(input: BackgroundSubagentStart.Input): Promise<BackgroundTask.Info> {
    const started = await BackgroundSubagentStart.start(input)
    claims.set(started.info.taskID, started.claim)
    return started.info
  }

  export function status(input: HandleInput): BackgroundTask.Info | undefined {
    const info = BackgroundTask.get(input.taskID)
    if (!info) return undefined
    if (info.parentSessionID !== input.parentSessionID) return undefined
    return info
  }

  export async function result(input: HandleInput): Promise<ResultView | undefined> {
    const info = status(input)
    if (!info) return undefined
    if (info.status !== "completed") {
      return { info, message: undefined }
    }
    if (!info.resultMessageID) {
      throw new Error(`Background task completed without result message: ${input.taskID}`)
    }
    const message = await MessageV2.get({
      sessionID: info.childSessionID,
      messageID: info.resultMessageID,
    })
    return { info, message }
  }

  export async function cancel(input: HandleInput): Promise<BackgroundTask.TransitionResult | undefined> {
    const info = status(input)
    if (!info) return undefined
    const claim = claims.get(input.taskID)
    if (!claim) {
      throw new Error(`Background task claim unavailable: ${input.taskID}`)
    }
    return BackgroundTaskSessionCancel.cancel(claim)
  }

  /** @internal Exported for tests. */
  export function resetForTests() {
    claims.clear()
  }
}
