import { Show, For, useContext, type Component } from "solid-js"
import type { EnrichedModel } from "../../context/provider"
import { SessionContext } from "../../context/session"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { sanitizeName } from "./model-selector-utils"
import { avgPrice, fmtCachedPrice, fmtPrice } from "./model-preview-utils"

interface Props {
  model: EnrichedModel | null
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

const MODALITY_KEYS: Record<string, string> = {
  text: "model.preview.modality.text",
  image: "model.preview.modality.image",
  audio: "model.preview.modality.audio",
  video: "model.preview.modality.video",
  pdf: "model.preview.modality.pdf",
}

export const ModelPreview: Component<Props> = (props) => {
  const m = () => props.model
  const session = useContext(SessionContext)
  const language = useLanguage()

  return (
    <div class="model-preview">
      <Show when={m()}>
        {(model) => {
          const cost = () => model().cost
          const cachedText = () => {
            if (!cost()) return ""
            return fmtCachedPrice(cost()!) ?? language.t("model.preview.value.notSupported")
          }
          const avg = () => (cost() ? avgPrice(cost()!) : undefined)
          const ctx = () => model().limit?.context ?? model().contextLength
          const caps = () => model().capabilities
          const inputs = () => caps()?.input
          const activeModalities = () =>
            inputs()
              ? (Object.entries(inputs()!) as [string, boolean][])
                  .filter(([, v]) => v)
                  .map(([k]) => {
                    const key = MODALITY_KEYS[k]
                    return key ? language.t(key) : k
                  })
              : []

          return (
            <>
              <Show when={model().isFree}>
                <span class="model-preview-badge model-preview-badge--free model-preview-badge--top-right">
                  {language.t("model.tag.free")}
                </span>
              </Show>
              {/* Header — name + provider + star */}
              <div class="model-preview-header">
                <div class="model-preview-name-row">
                  <span class="model-preview-name">{sanitizeName(model().name)}</span>
                  <Show when={session}>
                    {(() => {
                      const starred = () =>
                        session!
                          .favoriteModels()
                          .some((f) => f.providerID === model().providerID && f.modelID === model().id)
                      return (
                        <button
                          type="button"
                          class={`model-selector-star model-selector-star--preview${starred() ? " model-selector-star--active" : ""}`}
                          aria-label={
                            starred() ? language.t("model.favorite.remove") : language.t("model.favorite.add")
                          }
                          aria-pressed={starred()}
                          onClick={() => session!.toggleFavorite(model().providerID, model().id)}
                        >
                          <Icon name={starred() ? "star-filled" : "star"} size="small" />
                        </button>
                      )
                    })()}
                  </Show>
                </div>
                <span class="model-preview-provider">{model().providerName}</span>
              </div>

              {/* Properties grid */}
              <div class="model-preview-grid">
                {/* Release date */}
                <Show when={model().releaseDate}>
                  <span class="model-preview-label">{language.t("model.preview.label.released")}</span>
                  <span class="model-preview-value">{fmtDate(model().releaseDate!)}</span>
                </Show>

                {/* Pricing — hidden for free models */}
                <Show when={cost() && !model().isFree}>
                  <span class="model-preview-label">{language.t("model.preview.label.input")}</span>
                  <span class="model-preview-value">{fmtPrice(cost()!.input)}</span>
                  <span class="model-preview-label">{language.t("model.preview.label.output")}</span>
                  <span class="model-preview-value">{fmtPrice(cost()!.output)}</span>
                  <span class="model-preview-label">{language.t("model.preview.label.cached")}</span>
                  <span class="model-preview-value">{cachedText()}</span>
                  <Tooltip value={language.t("model.preview.tooltip.average")} placement="top">
                    <span class="model-preview-label model-preview-label--hint" tabIndex={0}>
                      {language.t("model.preview.label.average")}
                    </span>
                  </Tooltip>
                  <span class="model-preview-value">{fmtPrice(avg()!)}</span>
                </Show>

                {/* Context window */}
                <Show when={ctx()}>
                  <span class="model-preview-label">{language.t("model.preview.label.context")}</span>
                  <span class="model-preview-value">{fmtContext(ctx()!)}</span>
                </Show>
              </div>

              {/* Capabilities — free badge moved to header */}
              <Show when={caps()?.reasoning || activeModalities().length > 0}>
                <div class="model-preview-caps">
                  <Show when={caps()?.reasoning}>
                    <span class="model-preview-badge model-preview-badge--reasoning">
                      {language.t("model.preview.badge.reasoning")}
                    </span>
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
