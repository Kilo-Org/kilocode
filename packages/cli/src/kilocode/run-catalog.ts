import { isServiceUnavailableError, type ModelRef, type OpenCodeClient } from "@opencode/client/promise"
import { scheduler } from "node:timers/promises"
import { UI } from "../run/ui"

export type RunCatalogResolution = {
  model: ModelRef | undefined
  fallbackFrom?: ModelRef
}

/** A model list is a location snapshot, not a promise that all providers have published. */
export async function waitForRunCatalog(
  client: Pick<OpenCodeClient, "model" | "rpc">,
  directory: string,
  model: ModelRef | undefined,
  cancel: AbortSignal,
  timeoutMs = 30_000,
  format: "default" | "json" = "default",
  options: { fallbackToDefault?: boolean } = {},
): Promise<RunCatalogResolution> {
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([cancel, deadline])
  const query = { location: { directory } }
  const target = model ? `${model.providerID}/${model.id}` : "a default model"
  const progress =
    format === "default"
      ? setTimeout(() => UI.println(`${UI.Style.TEXT_DIM}⏳ kilo2 models: ${target}${UI.Style.TEXT_NORMAL}`), 1000)
      : undefined
  // Sample the local Gateway diagnostic shortly before expiry. Never extend the deadline to get it.
  let detail: string | undefined
  const diagnostic =
    !model || model.providerID === "kilo"
      ? setTimeout(
          () => {
            void gatewayDetail(client, directory, signal).then(
              (message) => {
                detail = message
              },
              () => {},
            )
          },
          Math.max(0, timeoutMs - 1000),
        )
      : undefined
  const fallback = async () => {
    if (!model || !options.fallbackToDefault) return undefined
    const { data } = await client.model.default(query, { signal: cancel })
    return data ? { model: { providerID: data.providerID, id: data.id }, fallbackFrom: model } : undefined
  }
  try {
    let previous = ""
    let stable = 0
    for (let delay = 100; ; delay = Math.min(1000, delay * 2)) {
      signal.throwIfAborted()
      if (!model) {
        const ready = await client.model
          .default(query, { signal })
          .then(({ data }) => data != null)
          .catch((error) => {
            if (isServiceUnavailableError(error)) return false
            throw error
          })
        if (ready) {
          signal.throwIfAborted()
          return { model: undefined }
        }
      } else {
        const data = await client.model.list(query, { signal }).then(
          (result) => result.data,
          (error) => {
            if (isServiceUnavailableError(error)) return undefined
            throw error
          },
        )
        if (data !== undefined) {
          if (data.some((entry) => entry.providerID === model.providerID && entry.id === model.id)) {
            signal.throwIfAborted()
            return { model }
          }
          if (options.fallbackToDefault) {
            const signature = data.map((entry) => `${entry.providerID}/${entry.id}`).sort().join("\n")
            stable = signature === previous ? stable + 1 : 0
            previous = signature
            // Three identical snapshots containing the provider are a settled catalog for fallback purposes.
            // If the model appears later, a subsequent run can select it; this run uses the configured default.
            if (stable >= 2 && data.some((entry) => entry.providerID === model.providerID)) {
              const resolved = await fallback()
              if (resolved) return resolved
            }
          }
        }
      }
      await scheduler.wait(delay, { signal })
    }
  } catch (error) {
    cancel.throwIfAborted()
    if (!deadline.aborted) throw error
    const resolved = await fallback().catch(() => undefined)
    if (resolved) return resolved
    throw new Error(
      `Timed out waiting for ${target} in the local model catalog. No prompt was sent. ${detail ?? "Check the available models with kilo2 models."}`,
    )
  } finally {
    clearTimeout(progress)
    clearTimeout(diagnostic)
  }
}

async function gatewayDetail(client: Pick<OpenCodeClient, "rpc">, directory: string, signal: AbortSignal) {
  const { KiloGatewayRpc } = await import("@opencode/schema/kilocode/gateway")
  const { Schema } = await import("effect")
  const { failure } = await client
    .rpc(KiloGatewayRpc.Definition)
    ["catalog.status"]({}, { location: { directory }, signal })
  if (Schema.is(KiloGatewayRpc.CatalogFailure)(failure)) return KiloGatewayRpc.catalogFailureMessage(failure)
}
