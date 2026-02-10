/**
 * Minimal provider/model selector.
 * - No persistence
 * - Uses provider catalog pushed from extension
 */

import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, ModelSelection, Provider } from "../../types/messages"

const KILO_PROVIDER_ID = "kilo"

type Props = {
  selection: () => ModelSelection | null
  setSelection: (next: ModelSelection) => void
}

export const ModelSelector: Component<Props> = (props) => {
  const vscode = useVSCode()

  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})

  onMount(() => {
    const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
      if (message.type !== "providersLoaded") {
        return
      }

      setProviders(message.providers)
      setConnected(message.connected)
      setDefaults(message.defaults)
    })

    vscode.postMessage({ type: "requestProviders" })

    onCleanup(unsubscribe)
  })

  const visibleProviders = createMemo(() => {
    const all = providers()
    const ids = Object.keys(all)
      .filter((id) => id === KILO_PROVIDER_ID || connected().includes(id))
      .sort((a, b) => a.localeCompare(b))

    return ids.map((id) => all[id]).filter(Boolean)
  })

  const hasProviders = createMemo(() => visibleProviders().length > 0)

  const currentProvider = createMemo(() => {
    const sel = props.selection()
    if (sel?.providerID && providers()[sel.providerID]) {
      return providers()[sel.providerID]
    }
    return providers()[KILO_PROVIDER_ID] ?? visibleProviders()[0]
  })

  const visibleModels = createMemo(() => {
    const provider = currentProvider()
    if (!provider) {
      return [] as Array<{ id: string; name: string }>
    }

    return Object.entries(provider.models)
      .map(([id, model]) => ({ id, name: model.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  createEffect(() => {
    // Ensure current selection is valid once we have a provider catalog.
    const provider = currentProvider()
    if (!provider) {
      return
    }

    const providerID = provider.id
    const sel = props.selection()
    if (sel?.providerID === providerID && sel.modelID && provider.models[sel.modelID]) {
      return
    }

    const defaultModelID = defaults()[providerID]
    const modelID =
      (defaultModelID && provider.models[defaultModelID] ? defaultModelID : undefined) ??
      Object.keys(provider.models)[0]

    if (modelID) {
      props.setSelection({ providerID, modelID })
    }
  })

  const providerID = () => props.selection()?.providerID ?? currentProvider()?.id
  const modelID = () => props.selection()?.modelID

  const onProviderChange = (nextProviderID: string) => {
    const provider = providers()[nextProviderID]
    if (!provider) {
      return
    }

    const defaultModelID = defaults()[nextProviderID]
    const nextModelID =
      (defaultModelID && provider.models[defaultModelID] ? defaultModelID : undefined) ??
      Object.keys(provider.models)[0]

    if (nextModelID) {
      props.setSelection({ providerID: nextProviderID, modelID: nextModelID })
    }
  }

  const onModelChange = (nextModelID: string) => {
    const pID = providerID()
    if (!pID) {
      return
    }
    props.setSelection({ providerID: pID, modelID: nextModelID })
  }

  return (
    <div class="model-selector">
      <Show when={hasProviders()} fallback={<span class="model-selector-empty">No providers</span>}>
        <select
          class="model-selector-select"
          value={providerID() ?? ""}
          onChange={(e) => onProviderChange(e.currentTarget.value)}
          aria-label="Model provider"
        >
          <For each={visibleProviders()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
        </select>

        <select
          class="model-selector-select"
          value={modelID() ?? ""}
          onChange={(e) => onModelChange(e.currentTarget.value)}
          aria-label="Model"
        >
          <For each={visibleModels()}>{(m) => <option value={m.id}>{m.name}</option>}</For>
        </select>
      </Show>
    </div>
  )
}

