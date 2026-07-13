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
    startupFailure?: Promise<{
      error: unknown
    }>
  }

  export interface Result {
    info: BackgroundTask.Info
    claim: BackgroundTask.Claim
  }

  type Ready =
    | {
        type: "opened"
      }
    | {
        type: "startup-failed"
        error: unknown
      }
    | {
        type: "ack-failed"
        error: unknown
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

    const opened = ack.then<Ready, Ready>(
      () => ({
        type: "opened",
      }),
      (error) => ({
        type: "ack-failed",
        error,
      }),
    )

    const startup = input.startupFailure?.then<Ready, Ready>(
      ({ error }) => ({
        type: "startup-failed",
        error,
      }),
      (error) => ({
        type: "startup-failed",
        error,
      }),
    )

    const ready = startup ? Promise.race([opened, startup]) : opened
    const clear = () =>
      ack.then(
        () => undefined,
        () => undefined,
      )

    try {
      input.launch()
    } catch (err) {
      controller.abort()
      await clear()
      BackgroundTask.transitionToFailed({
        ...created.claim,
        error: err,
      })
      throw err
    }

    const state = await ready
    if (state.type === "opened") {
      const running = BackgroundTask.transitionToRunning(created.claim)
      if (!running.applied || !running.info || running.info.status !== "running") {
        throw new Error("Background task failed to enter running state")
      }

      return { info: running.info, claim: created.claim }
    }

    if (state.type === "startup-failed") {
      controller.abort()
      await clear()
      const failed = BackgroundTask.transitionToFailed({
        ...created.claim,
        error: state.error,
      })
      if (!failed.applied || !failed.info || failed.info.status !== "failed") {
        throw new Error("Background task failed to enter failed state")
      }
      throw state.error
    }

    const failed = BackgroundTask.transitionToFailed({
      ...created.claim,
      error: state.error,
    })
    if (!failed.applied || !failed.info || failed.info.status !== "failed") {
      throw new Error("Background task failed to enter failed state")
    }
    throw state.error
  }
}
