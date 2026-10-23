// Kilo additions to the upstream model picker (`component/dialog-model.tsx`), as in v1: Kilo Gateway order and
// labels, and the model info panel in a wide terminal. The upstream file keeps its actions, selection and variant
// flow; it shows `options`, calls `move` when the highlight moves, and wraps its list with `frame`.
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { useTerminalDimensions } from "@opentui/solid" // kilo_port(unattributed:tui/component:9e2836eb85dc)
import { createEffect, createMemo, createResource, createSignal, Show, type Accessor, type JSX } from "solid-js"
import { useClient } from "../context/client"
import { useData } from "../context/data" // kilo_port(unattributed:tui/component:5c55d556d8ae)
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { useDialog } from "../ui/dialog"
import type { DialogSelectOption } from "../ui/dialog-select"
import { ModelInfoPanel } from "./components/model-info-panel"
import { buildModelPickerOptions, gatewayModel, KILO_PROVIDER_ID } from "./model-picker"

type Ref = { providerID: string; modelID: string }

export function createKiloModelPicker(input: {
  providerID?: string
  query: Accessor<string>
  connected: Accessor<boolean>
  showExtra: Accessor<boolean>
  onSelect: (providerID: string, modelID: string) => void
}) {
  const client = useClient()
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions() // kilo_port(unattributed:tui/component:a277acf3a84b)
  const ref = () => location.ref ?? data.location.default()
  const models = createMemo(() => data.location.model.list(location.ref) ?? [])
  const providers = createMemo(
    () => new Map((data.location.provider.list(location.ref) ?? []).map((item) => [item.id, item])),
  )

  // Gateway metadata comes from the `kilocode.gateway` models RPC. The picker only lists models of the model list,
  // so a model that the training policy hides gets no row and no label. Fetched again when the model list changes,
  // for example after a team switch. Without it (cold or failed catalog) the picker lists the models without
  // Gateway order and labels.
  // kilo_port(unattributed:tui/component:c8cf17d43819)
  const [gateway] = createResource(
    () =>
      models().some((model) => model.providerID === KILO_PROVIDER_ID)
        ? { location: ref(), models: models() }
        : undefined,
    (source) =>
      client.api
        .rpc(KiloGatewayRpc.Definition)
        .models({}, { location: source.location })
        .then((entries) => new Map(entries.map((entry) => [entry.id, entry])))
        .catch(() => new Map<string, KiloGatewayRpc.ModelEntry>()),
  )
  const metadata = createMemo(() => gateway.latest ?? new Map<string, KiloGatewayRpc.ModelEntry>())

  const options = createMemo(() =>
    buildModelPickerOptions({
      models: models(),
      providers: providers(),
      gateway: metadata(),
      favorites: input.connected() ? local.model.favorite() : [],
      recents: local.model.recent(),
      connected: input.connected(),
      showExtra: input.showExtra(),
      providerID: input.providerID,
      query: input.query(),
      onSelect: input.onSelect,
    }),
  )

  // kilo_port(unattributed:tui/component:85b11084275d) kilo_port(unattributed:tui/component:d10b36aa74a5) kilo_port(unattributed:tui/component:7fb2970f1e39)
  const wide = createMemo(() => dimensions().width >= 108)
  const [moved, setMoved] = createSignal<Ref>()
  const preview = createMemo(() => {
    const value = moved() ?? local.model.current()
    if (!value) return
    const model = models().find((item) => item.providerID === value.providerID && item.id === value.modelID)
    if (!model) return
    return {
      model,
      provider: providers().get(model.providerID)?.name ?? model.providerID,
      gateway: gatewayModel(model, metadata()),
    }
  })
  createEffect(() => dialog.setSize(wide() ? "xlarge" : "large"))

  return {
    options,
    move: (option: DialogSelectOption<Ref>) => setMoved(option.value),
    // kilo_port(unattributed:tui/component:361708efa0db)
    frame: (list: JSX.Element) => (
      <box flexDirection="row">
        <box flexGrow={1} flexShrink={1}>
          {list}
        </box>
        <Show when={wide() && preview()}>
          {(item) => <ModelInfoPanel model={item().model} provider={item().provider} gateway={item().gateway} />}
        </Show>
      </box>
    ),
  }
}
