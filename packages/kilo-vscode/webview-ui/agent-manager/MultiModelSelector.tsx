import { type Component, createSignal, createMemo, For, Show, onMount } from "solid-js"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import {
  freeDataLabel,
  hasByok,
  isDataCollectedModel,
  providerSortKey,
  toPickerModels,
  type PickerModel,
} from "../src/components/shared/model-selector-utils"
import type { KiloModelEntry } from "../src/v2/kilo-models"
import {
  type ModelAllocations,
  MAX_MULTI_VERSIONS,
  allocationKey,
  totalAllocations,
  toggleModel,
  setAllocationCount,
  setAllocationVariant,
  maxAllocationCount,
} from "./multi-model-utils"

export type { ModelAllocations }
export { MAX_MULTI_VERSIONS, totalAllocations, allocationsToArray } from "./multi-model-utils"

interface ModelGroup {
  providerName: string
  models: (PickerModel & { variants: string[] })[]
}

const COUNT_OPTIONS = Array.from({ length: MAX_MULTI_VERSIONS }, (_, i) => i + 1)

/** The compare picker of v1: provider groups in the v1 provider order, with the Free, BYOK and training badges. */
export const MultiModelSelector: Component<{
  allocations: ModelAllocations
  onChange: (allocations: ModelAllocations) => void
  models: ModelInfo[]
  providers: ProviderInfo[]
  /** Kilo Gateway metadata by model id, for the badges. */
  gateway?: ReadonlyMap<string, KiloModelEntry>
}> = (props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  let searchRef: HTMLInputElement | undefined

  const dataLabel = () => freeDataLabel(t("model.tag.free"), t("model.tag.dataCollected"))
  const visibleModels = createMemo(() => {
    const models = props.models.filter((model) => model.enabled)
    return toPickerModels(models, props.providers, props.gateway).map((model, index) => ({
      ...model,
      variants: models[index]?.variants.map((variant) => variant.id) ?? [],
    }))
  })
  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    if (!q) return visibleModels()
    return visibleModels().filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.providerName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  })
  const groups = createMemo<ModelGroup[]>(() => {
    const map = new Map<string, ModelGroup>()
    for (const model of filtered()) {
      let group = map.get(model.providerID)
      if (!group) {
        group = { providerName: model.providerName, models: [] }
        map.set(model.providerID, group)
      }
      group.models.push(model)
    }
    return [...map.entries()].sort(([a], [b]) => providerSortKey(a) - providerSortKey(b)).map(([, group]) => group)
  })

  onMount(() => requestAnimationFrame(() => searchRef?.focus()))

  return (
    <div class="am-mm-wrapper">
      <div class="am-mm-search">
        <Icon name="magnifying-glass" size="small" />
        <input
          ref={searchRef}
          class="am-mm-search-input"
          type="text"
          placeholder={t("agentManager.dialog.compareModels.searchModels")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      <div class="am-mm-list">
        <For each={groups()}>
          {(group) => (
            <>
              <div class="am-mm-group-label">{group.providerName}</div>
              <For each={group.models}>
                {(model) => {
                  const key = () => allocationKey(model.providerID, model.id)
                  const checked = () => props.allocations.has(key())
                  const entry = () => props.allocations.get(key())
                  const disabled = () => !checked() && totalAllocations(props.allocations) >= MAX_MULTI_VERSIONS
                  const efforts = () => model.variants
                  return (
                    <div
                      class="am-mm-item"
                      classList={{
                        "am-mm-item-checked": checked(),
                        "am-mm-item-disabled": disabled(),
                      }}
                    >
                      <label class="am-mm-item-label">
                        <input
                          type="checkbox"
                          class="am-mm-checkbox"
                          checked={checked()}
                          disabled={disabled()}
                          onChange={() =>
                            props.onChange(toggleModel(props.allocations, model.providerID, model.id, model.name))
                          }
                        />
                        <span class="am-mm-item-name">{model.name}</span>
                        <Show when={model.isFree || hasByok(model) || isDataCollectedModel(model)}>
                          <span class="am-mm-free-data">
                            <Show when={model.isFree && !hasByok(model)}>
                              <span class="am-mm-free-badge">{t("model.tag.free")}</span>
                            </Show>
                            <Show when={hasByok(model)}>
                              <span class="am-mm-byok-badge">BYOK</span>
                            </Show>
                            <Show when={isDataCollectedModel(model)}>
                              <Tooltip value={dataLabel()} placement="top">
                                <span class="am-mm-free-data-icon" aria-label={dataLabel()}>
                                  <Icon name="book-open-check" size="small" />
                                </span>
                              </Tooltip>
                            </Show>
                          </span>
                        </Show>
                      </label>
                      <Show when={checked()}>
                        <Show when={efforts().length > 0}>
                          <select
                            class="am-mm-count-select am-mm-variant-select"
                            value={entry()?.variant ?? ""}
                            title={t("agentManager.dialog.compareModels.effort")}
                            aria-label={t("agentManager.dialog.compareModels.effort")}
                            onChange={(e) =>
                              props.onChange(
                                setAllocationVariant(
                                  props.allocations,
                                  model.providerID,
                                  model.id,
                                  e.currentTarget.value || undefined,
                                ),
                              )
                            }
                          >
                            <option value="">{t("agentManager.dialog.compareModels.effortDefault")}</option>
                            <For each={efforts()}>{(variant) => <option value={variant}>{variant}</option>}</For>
                          </select>
                        </Show>
                        <select
                          class="am-mm-count-select"
                          value={entry()?.count ?? 1}
                          onChange={(e) =>
                            props.onChange(
                              setAllocationCount(
                                props.allocations,
                                model.providerID,
                                model.id,
                                Number(e.currentTarget.value),
                              ),
                            )
                          }
                        >
                          <For
                            each={COUNT_OPTIONS.filter(
                              (count) => count <= maxAllocationCount(props.allocations, model.providerID, model.id),
                            )}
                          >
                            {(count) => <option value={count}>{count}x</option>}
                          </For>
                        </select>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
