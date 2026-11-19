import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { LocationRef, ModelInfo, ModelRef, OpenCodeClient } from "../promise/index.js"

/** Wait for the target catalog, not plugin activation, before admitting a model-dependent request. */
export async function waitForModel(
  client: OpenCodeClient,
  input: { location: LocationRef; model?: ModelRef; signal?: AbortSignal; timeout?: number },
): Promise<boolean> {
  const deadline = new AbortController()
  const selected = input.model
  const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(), input.timeout ?? 30_000)
  try {
    while (true) {
      signal.throwIfAborted()
      const models = (await client.model.list({ location: input.location }, { signal })).data
      if (models.some((model) => available(model, selected))) return true
      // A populated provider missing the selection is not a cold catalog. Leave its error to the caller.
      if (selected && models.some((model) => model.providerID === selected.providerID)) return false
      if ((!selected || selected.providerID === "kilo") && (await catalogFailed(client, input.location, signal)))
        return false
      await wait(signal)
    }
  } catch (error) {
    input.signal?.throwIfAborted()
    if (!deadline.signal.aborted) throw error
    return false
  } finally {
    clearTimeout(timer)
  }
}

function available(model: ModelInfo, selected: ModelRef | undefined) {
  if (!model.enabled || (model.type ?? "chat") !== "chat") return false
  if (selected) return model.providerID === selected.providerID && model.id === selected.id
  return [model.capabilities.input, model.capabilities.output].every(
    (types) => types.length === 0 || types.some((type) => type.startsWith("text")),
  )
}

async function catalogFailed(client: OpenCodeClient, location: LocationRef, signal: AbortSignal) {
  return client
    .rpc(KiloGatewayRpc.Definition)
    ["catalog.status"]({}, { location, signal })
    .then((status) => status.failure !== null)
    .catch((error: unknown) => {
      // The RPC itself is absent until the Gateway plugin has registered it.
      if (error && typeof error === "object" && "type" in error && error.type === "rpc.unavailable") return false
      throw error
    })
}

function wait(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, 100)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}
