import type { Component } from "solid-js"
import { For, Show, createMemo } from "solid-js"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import type { SessionModelUsage } from "../../types/messages"
import { groupModelUsage, modelUsageName, type TokenSummary } from "../../context/model-usage"
import { formatCompactCount } from "../../utils/format"

interface TaskUsageProps {
  tokens: TokenSummary
  usage?: SessionModelUsage
  /** Aggregated text-generation rate (tokens/sec) for the session.
   *  Renders inline in the summary row when defined, matching the existing
   *  token-value spans so the row reads as one line of secondary info. */
  throughput?: number
  defaultOpen?: boolean
}

export const TaskUsage: Component<TaskUsageProps> = (props) => {
  const language = useLanguage()
  const provider = useProvider()
  const groups = createMemo(() => groupModelUsage(props.usage?.models ?? [], provider.providers()))
  const tgText = createMemo(() => {
    const v = props.throughput
    if (v === undefined || !Number.isFinite(v) || v <= 0) return undefined
    return `${new Intl.NumberFormat(language.locale(), { maximumFractionDigits: 1 }).format(v)} t/s`
  })
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
  const rate = (model: SessionModelUsage["models"][number]) => {
    const total = model.tokens.input + model.tokens.cache.read
    if (total === 0) return "-"
    return `${((model.tokens.cache.read / total) * 100).toFixed(1)}%`
  }

  const Summary = () => (
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
      <Show when={tgText()}>
        <span class="task-header-tokens-value">TG {tgText()}</span>
      </Show>
    </>
  )

  return (
    <Show
      when={props.usage?.models.length}
      fallback={
        <div class="task-header-tokens">
          <Summary />
        </div>
      }
    >
      <Collapsible variant="ghost" class="task-header-usage tool-collapsible" defaultOpen={props.defaultOpen}>
        <Collapsible.Trigger class="task-header-usage-trigger">
          <span class="task-header-tokens">
            <Summary />
          </span>
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
                          {modelUsageName(model, provider.providers())}
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
                          {rate(model)}
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
