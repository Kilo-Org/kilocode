// kilocode_change - new file
import type { MessageID, SessionID } from "@/session/schema"
import { BackgroundTask } from "./background-task"
import { BackgroundTaskStart } from "./background-task-start"
import { BackgroundTaskCompletion } from "./background-task-completion"

export namespace BackgroundTaskRuntime {
  type Settled = { ok: true; value: { resultMessageID: MessageID } } | { ok: false; error: unknown }

  const active = new Map<string, Promise<void>>()

  function claimKey(claim: BackgroundTask.Claim) {
    return `${claim.taskID}:${claim.generation}`
  }

  export async function start(input: {
    parentSessionID: SessionID
    childSessionID: SessionID
    childUserMessageID: MessageID
    launch: () => void
    completion: Promise<{ resultMessageID: MessageID }>
  }): Promise<BackgroundTaskStart.Result> {
    const settled = input.completion.then<Settled, Settled>(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    )

    const neverFailure = new Promise<never>(() => {})
    const startupFailure: Promise<{
      error: unknown
    }> = settled.then((state) => {
      if (state.ok) return neverFailure
      return {
        error: state.error,
      }
    })

    const result = await BackgroundTaskStart.start({
      parentSessionID: input.parentSessionID,
      childSessionID: input.childSessionID,
      childUserMessageID: input.childUserMessageID,
      launch: input.launch,
      startupFailure,
    })

    const completion = settled.then((state) => {
      if (state.ok) return state.value
      throw state.error
    })

    const observer = BackgroundTaskCompletion.observe({
      claim: result.claim,
      completion,
    })

    const k = claimKey(result.claim)
    let retained: Promise<void> | undefined
    retained = observer.then(
      () => {
        if (active.get(k) === retained) active.delete(k)
      },
      () => {
        if (active.get(k) === retained) active.delete(k)
      },
    )
    active.set(k, retained)

    return result
  }

  export function isObserving(claim: BackgroundTask.Claim): boolean {
    return active.has(claimKey(claim))
  }

  export function resetForTests() {
    active.clear()
  }
}
