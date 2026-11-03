import { type Component, createSignal, createMemo, For, Show, onMount } from "solid-js"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../src/context/language"
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
  models: ModelInfo[]
}

const COUNT_OPTIONS = Array.from({ length: MAX_MULTI_VERSIONS }, (_, i) => i + 1)

/** A model is free when every cost it lists is zero. */
function isFree(model: ModelInfo) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0 && cost.output === 0)
}

/** The v2 catalog has no favorites or popularity order, so providers stay in catalog order. */
export const MultiModelSelector: Component<{
  allocations: ModelAllocations
  onChange: (allocations: ModelAllocations) => void
  models: ModelInfo[]
  providers: ProviderInfo[]
}> = (props) => {
  const { t } = useLanguage()
  const [search, setSearch] = createSignal("")
  let searchRef: HTMLInputElement | undefined

  const providerNames = createMemo(() => new Map(props.providers.map((provider) => [provider.id, provider.name])))
  const visibleModels = createMemo(() => props.models.filter((model) => model.enabled))
  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    if (!q) return visibleModels()
    return visibleModels().filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (providerNames().get(m.providerID) ?? "").toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    )
  })
  const groups = createMemo<ModelGroup[]>(() => {
    const map = new Map<string, ModelGroup>()
    for (const model of filtered()) {
      let group = map.get(model.providerID)
      if (!group) {
        group = { providerName: providerNames().get(model.providerID) ?? model.providerID, models: [] }
        map.set(model.providerID, group)
      }
      group.models.push(model)
    }
    return [...map.values()]
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
                  const efforts = () => model.variants.map((variant) => variant.id)
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
                        <Show when={isFree(model)}>
                          <span class="am-mm-free-data">
                            <span class="am-mm-free-badge">{t("model.tag.free")}</span>
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