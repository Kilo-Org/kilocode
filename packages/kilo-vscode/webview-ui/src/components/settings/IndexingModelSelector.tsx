import { Component, Show, createMemo } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import {
  getEmbeddingModelOptions,
  getEmbeddingModelOption,
} from "@kilocode/kilo-indexing/model-registry"
import type { IndexingProvider as ProviderId } from "../../types/messages"
import SettingsRow from "./SettingsRow"

const CUSTOM_MODEL_VALUE = "__custom__"

interface ModelSelectorProps {
  provider: ProviderId | undefined
  model: string | null | undefined
  scope: string
  customDraft: Record<string, string>
  tag: () => string | undefined
  description: string
  onSelect: (model: string, dimension: number | null, scoreThreshold: number | undefined) => void
  onCustomChange: (draft: Record<string, string>, model: string | null) => void
}

const IndexingModelSelector: Component<ModelSelectorProps> = (props) => {
  const options = createMemo(() => {
    const p = props.provider
    if (!p || p === "kilo") return []
    const opts = getEmbeddingModelOptions(p)
    if (opts.length === 0) return []
    return [
      ...opts.map((m) => ({ value: m.id, label: `${m.label} (${m.dimension}d)` })),
      { value: CUSTOM_MODEL_VALUE, label: "Custom..." },
    ]
  })

  const isCustom = () => {
    const p = props.provider
    const m = props.model
    if (!p || p === "kilo" || !m) return false
    const opts = getEmbeddingModelOptions(p)
    return opts.length > 0 && !opts.some((o) => o.id === m)
  }

  const selectValue = () => {
    const p = props.provider
    const m = props.model
    if (!p || p === "kilo" || !m) return undefined
    const opts = getEmbeddingModelOptions(p)
    if (opts.length === 0) return undefined
    if (opts.some((o) => o.id === m)) return m
    return CUSTOM_MODEL_VALUE
  }

  const handleSelect = (value: string) => {
    const p = props.provider
    if (!p || p === "kilo") return
    if (value === CUSTOM_MODEL_VALUE) {
      props.onSelect("", null, undefined)
      return
    }
    const opt = getEmbeddingModelOption(p, value)
    props.onSelect(value, opt?.dimension ?? null, opt?.scoreThreshold)
  }

  const handleCustom = (value: string) => {
    const p = props.provider
    if (!p || p === "kilo") return
    const trimmed = value.trim()
    props.onCustomChange(
      { ...props.customDraft, [`${props.scope}.${p}`]: trimmed },
      trimmed || null,
    )
  }

  return (
    <Show
      when={options().length > 0}
      fallback={
        <SettingsRow
          title="Model"
          description={props.description}
          tag={props.tag}
        >
          <TextField
            value={props.model ?? ""}
            placeholder="Enter model ID"
            onChange={(value) => {
              const trimmed = value.trim()
              props.onSelect(trimmed, null, undefined)
            }}
          />
        </SettingsRow>
      }
    >
      <SettingsRow title="Model" description={props.description} tag={props.tag}>
        <Select
          options={options()}
          current={options().find((item) => item.value === selectValue())}
          value={(item) => item.value}
          label={(item) => item.label}
          onSelect={(item) => handleSelect(item?.value ?? "")}
          variant="secondary"
          size="small"
          triggerVariant="settings"
          placeholder="Select a model"
        />
      </SettingsRow>
      <Show when={isCustom() || selectValue() === CUSTOM_MODEL_VALUE}>
        <SettingsRow
          title="Custom Model ID"
          description="Enter the exact model identifier for your provider"
        >
          <TextField
            value={props.customDraft[`${props.scope}.${props.provider}`] ?? props.model ?? ""}
            placeholder="e.g. my-custom-model"
            onChange={handleCustom}
          />
        </SettingsRow>
      </Show>
    </Show>
  )
}

export default IndexingModelSelector
