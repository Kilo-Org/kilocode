/**
 * TaskUsage — the token row of the task header graph section.
 *
 * The summary always shows the subtree input, cache read and output. Opening it lists every provider and model with
 * steps, cost, input, output, reasoning, cache read, cache write and hit rate.
 */

import type { ProviderInfo } from "@opencode/client"
import type { Component } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useV2 } from "../../v2/client"
import { cacheRate, groupModelsByProvider, modelLabel, type ModelUsage } from "../../v2/session-usage"
import { formatCompactCount } from "../../utils/format"

export interface TaskUsageProps {
  tokens: { input: number; output: number; cached: number }
  models: readonly ModelUsage[]
  providers: readonly ProviderInfo[]
}

export const TaskUsage: Component<TaskUsageProps> = (props) => {
  const language = useLanguage()
  const v2 = useV2()
  const groups = createMemo(() => groupModelsByProvider(props.models, props.providers))
  const money = createMemo(
    () =>
      new Intl.NumberFormat(language.locale(), {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      }),
  )

  const number = formatCompactCount
  const count = (value: number) => value.toLocaleString(language.locale())
  const cost = (input: number) => {
    const value = Math.max(0, Number.isFinite(input) ? input : 0)
    if (value > 0 && value < 0.000001) return "<$0.000001"
    return money().format(value)
  }
  const name = (model: ModelUsage) =>
    modelLabel({ providerID: model.providerID, id: model.modelID }, v2.data.location.model.list())
  const renderSummary = () => (
    <>
      <span class="task-header-tokens-label">Tokens</span>
      <Show when={props.tokens.input > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-up" size="small" />
          {number(props.tokens.input)}
        </span>
      </Show>
      <Show when={props.tokens.cached > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-up" size="small" />
          cache {number(props.tokens.cached)}
        </span>
      </Show>
      <Show when={props.tokens.output > 0}>
        <span class="task-header-tokens-value">
          <Icon name="arrow-down-to-line" size="small" />
          {number(props.tokens.output)}
        </span>
      </Show>
    </>
  )

  return (
    <Show when={props.models.length} fallback={<div class="task-header-tokens">{renderSummary()}</div>}>
      <Collapsible variant="ghost" class="task-header-usage tool-collapsible">
        <Collapsible.Trigger class="task-header-usage-trigger">
          <span class="task-header-tokens">{renderSummary()}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div class="task-header-usage-detail">
            <For each={groups()}>
              {(group) => (
                <section class="task-header-usage-provider">
                  <h4>{group.providerName}</h4>
                  <For each={group.models}>
                    {(model) => (
                      <div class="task-header-usage-model">
                        <div class="task-header-usage-model-name" title={`${model.providerID}/${model.modelID}`}>
                          {name(model)}
                        </div>
                        <div class="task-header-usage-meta">
                          {model.steps} {model.steps === 1 ? "step" : "steps"} · {cost(model.cost)}
                        </div>
                        <div class="task-header-usage-meta">
                          In {count(model.tokens.input)} · Out {count(model.tokens.output)} · Reason{" "}
                          {count(model.tokens.reasoning)}
                        </div>
                        <div class="task-header-usage-meta">
                          Cache R {count(model.tokens.cache.read)} · W {count(model.tokens.cache.write)} · Hit Rate{" "}
                          {cacheRate(model.tokens)}
                        </div>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}
