import { Component, For, Show } from "solid-js"
import type { KiloPassState, ProviderUsageData } from "../../types/messages"
import type { ProviderUsageSnapshot } from "@kilocode/sdk/v2/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardActions, CardDescription, CardHeader, CardTitle } from "@kilocode/kilo-ui/card"
import { KiloPassMeter } from "@kilocode/kilo-ui/kilo-pass-meter"
import { Progress } from "@kilocode/kilo-ui/progress"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { localeToBcp47 } from "../../context/language-utils"
import { formatWindow, windowProgress } from "@kilocode/kilo-gateway/provider-usage"

export interface ProviderUsageCardsProps {
  data: ProviderUsageData | undefined
  loading: boolean
  error?: string
  kiloPass?: KiloPassState | null
  showKiloPass: boolean
  onRefresh: () => void
  onOpen: (url: string) => void
  onGetKiloPass: () => void
}

type Language = ReturnType<typeof useLanguage>

const source = (item: ProviderUsageSnapshot, language: Language) => {
  if (item.sourceKind === "kilo_managed") return "Kilo Gateway"
  return language.t("profile.usage.source.direct")
}

const labels = (language: Language) => ({
  unlimited: language.t("profile.usage.status.unlimited"),
  notInPlan: language.t("profile.usage.status.notInPlan"),
  unknown: language.t("profile.usage.status.unknown"),
  exhausted: language.t("profile.usage.status.exhausted"),
  used: (value: string) => language.t("profile.usage.window.used", { value }),
  remaining: (value: string) => language.t("profile.usage.window.remaining", { value }),
  remainingOf: (value: string, limit: string) => language.t("profile.usage.window.remainingOf", { value, limit }),
  usedOf: (value: string, limit: string) => language.t("profile.usage.window.usedOf", { value, limit }),
})

const variant = (item: ProviderUsageSnapshot) => {
  if (item.fetchState === "error") return "error" as const
  if (item.fetchState !== "ready" || item.planState === "past_due") return "warning" as const
  return "normal" as const
}

const order = (items: ProviderUsageSnapshot[]) =>
  [...items].sort(
    (left, right) => Number(left.sourceKind !== "kilo_managed") - Number(right.sourceKind !== "kilo_managed"),
  )

const UsageCard: Component<{
  item: ProviderUsageSnapshot
  onOpen: (url: string) => void
  language: Language
}> = (props) => (
  <Card variant={variant(props.item)}>
    <CardHeader>
      <div>
        <CardTitle icon={false} role="heading" aria-level={4}>
          {props.item.providerLabel}
        </CardTitle>
        <CardDescription>{props.item.planLabel}</CardDescription>
      </div>
      <Tag>{source(props.item, props.language)}</Tag>
    </CardHeader>

    <Show when={props.item.planState !== "active"}>
      <CardDescription>
        {props.language.t(
          props.item.planState === "past_due"
            ? "profile.usage.plan.pastDue"
            : props.item.planState === "canceling"
              ? "profile.usage.plan.canceling"
              : "profile.usage.plan.unknown",
        )}
      </CardDescription>
    </Show>

    <Show when={props.item.fetchState !== "ready"}>
      <p class="provider-usage-notice">
        {props.item.fetchState === "stale"
          ? props.language.t("profile.usage.state.stale")
          : props.language.t("profile.usage.state.unavailable")}
      </p>
    </Show>

    <div class="provider-usage-resources">
      <For each={props.item.windows}>
        {(window) => {
          const progress = () => windowProgress(window)
          const value = () => formatWindow(window, labels(props.language))
          return (
            <div class="provider-usage-row">
              <Show when={progress() !== undefined}>
                <Progress
                  value={progress()}
                  minValue={0}
                  maxValue={100}
                  showValueLabel
                  getValueLabel={value}
                  aria-label={`${window.label}: ${value()}`}
                  aria-valuetext={value()}
                >
                  {window.label}
                </Progress>
              </Show>
              <Show when={progress() === undefined}>
                <div class="provider-usage-summary">
                  <span>{window.label}</span>
                  <strong>{value()}</strong>
                </div>
              </Show>
              <Show when={window.resetAt}>
                {(reset) => (
                  <CardDescription>
                    {props.language.t("profile.usage.reset", { date: new Date(reset()).toLocaleString() })}
                  </CardDescription>
                )}
              </Show>
            </div>
          )
        }}
      </For>
    </div>

    <Show when={props.item.routingState !== "active" && props.item.routingState !== "not_applicable"}>
      <p class="provider-usage-notice">
        {props.language.t("profile.usage.routing", {
          state: props.language.t(`profile.usage.routingState.${props.item.routingState}`),
        })}
      </p>
    </Show>

    <Show when={props.item.managementUrl}>
      {(url) => (
        <CardActions>
          <Button
            variant="secondary"
            size="small"
            onClick={() => props.onOpen(url())}
            aria-label={`Manage ${props.item.planLabel}`}
          >
            {props.language.t("profile.usage.action.manage")}
          </Button>
        </CardActions>
      )}
    </Show>
  </Card>
)

const money = (value: number) => `$${value.toFixed(2)}`

const KiloPassCard: Component<{
  pass?: KiloPassState | null
  onGet: () => void
  language: Language
}> = (props) => {
  const renewal = () => {
    const value = props.pass?.nextBillingAt
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return undefined
    return new Intl.DateTimeFormat(localeToBcp47(props.language.locale()), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(date)
  }
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle icon={false} role="heading" aria-level={4}>
            Kilo
          </CardTitle>
          <CardDescription>Kilo Pass</CardDescription>
        </div>
        <Tag>Kilo Gateway</Tag>
      </CardHeader>
      <Show
        when={props.pass}
        fallback={
          <CardActions>
            <Button variant="secondary" size="small" onClick={props.onGet}>
              {props.language.t("profile.pass.subscribe")}
            </Button>
          </CardActions>
        }
      >
        {(pass) => (
          <div class="provider-usage-resources">
            <KiloPassMeter
              used={pass().currentPeriodUsageUsd}
              paid={pass().currentPeriodBaseCreditsUsd}
              bonus={pass().currentPeriodBonusCreditsUsd}
              label="This month's usage"
              paidLabel="Paid"
              bonusLabel={props.language.t("profile.pass.bonus")}
              format={money}
              aria-label="Kilo Pass monthly usage"
            />
            <Show when={renewal()}>
              {(date) => (
                <div class="provider-usage-summary">
                  <span>{props.language.t("profile.pass.renews")}</span>
                  <strong>{date()}</strong>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>
    </Card>
  )
}

export const ProviderUsageCards: Component<ProviderUsageCardsProps> = (props) => {
  const language = useLanguage()
  return (
    <section class="provider-usage-section" aria-labelledby="provider-usage-title">
      <div class="provider-usage-section-heading">
        <div>
          <h3 id="provider-usage-title">{language.t("profile.usage.title")}</h3>
          <p>{language.t("profile.usage.description")}</p>
        </div>
        <Button
          variant="ghost"
          size="small"
          onClick={props.onRefresh}
          disabled={props.loading}
          aria-label={language.t("profile.usage.refresh")}
        >
          {props.loading ? <Spinner style={{ width: "14px", height: "14px" }} /> : `↻ ${language.t("common.refresh")}`}
        </Button>
      </div>

      <div class="provider-usage-list">
        <Show when={props.showKiloPass}>
          <KiloPassCard pass={props.kiloPass} onGet={props.onGetKiloPass} language={language} />
        </Show>
        <Show
          when={props.data}
          fallback={
            <Show
              when={!props.loading && props.error}
              fallback={
                <div class="provider-usage-loading" role="status" aria-label={language.t("profile.usage.title")}>
                  <Spinner />
                </div>
              }
            >
              {(error) => (
                <Card variant="warning" role="alert">
                  <CardDescription>{error()}</CardDescription>
                </Card>
              )}
            </Show>
          }
        >
          {(data) => (
            <>
              <Show
                when={data().items.length > 0}
                fallback={
                  <Show when={!props.showKiloPass}>
                    <Card>
                      <CardDescription>{language.t("profile.usage.empty")}</CardDescription>
                    </Card>
                  </Show>
                }
              >
                <For each={order(data().items)}>
                  {(item) => <UsageCard item={item} onOpen={props.onOpen} language={language} />}
                </For>
              </Show>
            </>
          )}
        </Show>
      </div>
    </section>
  )
}
