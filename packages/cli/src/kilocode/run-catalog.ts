import { isServiceUnavailableError, type ModelRef, type OpenCodeClient } from "@opencode/client/promise"
import { setTimeout } from "node:timers/promises"

/** A model list is a location snapshot, not a promise that all providers have published. */
export async function waitForRunCatalog(
  client: Pick<OpenCodeClient, "model">,
  directory: string,
  model: ModelRef | undefined,
  cancel: AbortSignal,
  timeoutMs = 30_000,
) {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([cancel, deadline])
  const query = { location: { directory } }
  try {
    for (let delay = 100; ; delay = Math.min(1000, delay * 2)) {
      signal.throwIfAborted()
      const ready = model
        ? client.model
            .list(query, { signal })
            .then(({ data }) => data.some((entry) => entry.providerID === model.providerID && entry.id === model.id))
        : client.model.default(query, { signal }).then(({ data }) => data != null)
      if (
        await ready.catch((error) => {
          if (isServiceUnavailableError(error)) return false
          throw error
        })
      ) {
        signal.throwIfAborted()
        return
      }
      await setTimeout(delay, undefined, { signal })
    }
  } catch (error) {
    cancel.throwIfAborted()
    if (!deadline.aborted) throw error
    const target = model ? `${model.providerID}/${model.id}` : "a default model"
    throw new Error(
      `Timed out waiting for ${target} in the local model catalog. No prompt was sent. Check the available models with kilo2 models.`,
    )
  }
}
