import { createMemo, createResource } from "solid-js"
import { useClient } from "../context/client"
import { locationKey, useData } from "../context/data"
import { useLocation } from "../context/location"

export function createGatewayDefaultModel() {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const source = createMemo(() => {
    if (client.connection.status() !== "connected") return
    const ref = location.ref ?? data.location.default()
    const models = data.location.model.list(ref)
    if (models === undefined) return
    return { location: ref, models, config: data.location.config.list(ref) }
  })
  const [result] = createResource(source, async (source) => {
    const response = await client.api.model.default({ location: source.location }).catch(() => undefined)
    return {
      source,
      model: response?.data ? { providerID: response.data.providerID, modelID: response.data.id } : undefined,
    }
  })
  const current = createMemo(() => {
    const value = result()
    const input = source()
    if (!value?.model || !input || locationKey(value.source.location) !== locationKey(input.location)) return
    const selected = value.model
    return input.models.some((model) => model.providerID === selected.providerID && model.id === selected.modelID)
      ? selected
      : undefined
  })

  return {
    current,
    ready: () => !!current() || !result.loading,
  }
}
