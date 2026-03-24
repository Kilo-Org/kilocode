import { Component, Show, For } from "solid-js"
import type { EnrichedModel } from "../../context/provider"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { sanitizeName } from "./model-selector-utils"

interface Props {
  model: EnrichedModel | null
}

function fmtPrice(n: number): string {
  if (n === 0) return "Free"
  const per1M = n * 1_000_000
  if (per1M < 0.01) return `$${per1M.toFixed(4)}/1M`
  return `$${per1M.toFixed(2)}/1M`
}

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(n)
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" })
}

const MODALITY_LABELS: Record<string, string> = {
  text: "Text",
  image: "Images",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
}

export const ModelPreview: Component<Props> = (props) => {
  const m = () => props.model

  return (
    <div class="model-preview">
      <Show when={m()}>
        {(model) => {
          const cost = () => model().cost
          const ctx = () => model().limit?.context ?? model().contextLength
          const caps = () => model().capabilities
          const inputs = () => caps()?.input
          const activeModalities = () =>
            inputs()
              ? (Object.entries(inputs()!) as [string, boolean][])
                  .filter(([, v]) => v)
                  .map(([k]) => MODALITY_LABELS[k] ?? k)
              : []

          return (
            <>
              <Show when={model().isFree}>
                <span class="model-preview-badge model-preview-badge--free model-preview-badge--top-right">Free</span>
              </Show>
              {/* Header — name + provider */}
              <div class="model-preview-header">
                <div class="model-preview-name-row">
                  <span class="model-preview-name">{sanitizeName(model().name)}</span>
                </div>
                <span class="model-preview-provider">{model().providerName}</span>
              </div>

              {/* Properties grid */}
              <div class="model-preview-grid">
                {/* Release date */}
                <Show when={model().releaseDate}>
                  <span class="model-preview-label">Released</span>
                  <span class="model-preview-value">{fmtDate(model().releaseDate!)}</span>
                </Show>

                {/* Pricing — hidden for free models */}
                <Show when={cost() && !model().isFree}>
                  <span class="model-preview-label">Input</span>
                  <span class="model-preview-value">{fmtPrice(cost()!.input)}</span>
                  <span class="model-preview-label">Output</span>
                  <span class="model-preview-value">{fmtPrice(cost()!.output)}</span>
                </Show>

                {/* Context window */}
                <Show when={ctx()}>
                  <span class="model-preview-label">Context</span>
                  <span class="model-preview-value">{fmtContext(ctx()!)}</span>
                </Show>
              </div>

              {/* Capabilities — free badge moved to header */}
              <Show when={caps()?.reasoning || activeModalities().length > 0}>
                <div class="model-preview-caps">
                  <Show when={caps()?.reasoning}>
                    <span class="model-preview-badge model-preview-badge--reasoning">Reasoning</span>
                  </Show>
                  <For each={activeModalities()}>{(label) => <span class="model-preview-badge">{label}</span>}</For>
                </div>
              </Show>

              {/* Description */}
              <Show when={model().options?.description}>
                <div class="model-preview-description">
                  <Markdown text={model().options!.description!} />
                </div>
              </Show>
            </>
          )
        }}
      </Show>
    </div>
  )
}
