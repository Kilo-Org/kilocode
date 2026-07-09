import { Component, For, Show } from "solid-js"
import type { ProviderUsageData } from "../../types/messages"
import type { ProviderUsageSnapshot } from "@kilocode/sdk/v2/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardActions, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Progress } from "@kilocode/kilo-ui/progress"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { formatWindowValue, windowProgress } from "./provider-usage-format"

export interface ProviderUsageCardsProps {
  data: ProviderUsageData | undefined
  loading: boolean
  error?: string
  onRefresh: () => void
  onOpen: (url: string) => void
}

type Language = ReturnType<typeof useLanguage>

const source = (item: ProviderUsageSnapshot, language: Language) => {
  if (item.sourceKind === "kilo_managed")
    return language.t("profile.usage.source.viaKilo")
  if (item.sourceKind === "codex") return language.t("profile.usage.source.chatgpt")
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

const UsageCard: Component<{
  item: ProviderUsageSnapshot
  onOpen: (url: string) => void
  language: Language
}> = (props) => (
  <Card class="provider-usage-card" variant={variant(props.item)}>
    <div class="provider-usage-heading">
      <div>
        <CardTitle icon={false}>{props.item.providerLabel}</CardTitle>
        <CardDescription>{props.item.planLabel}</CardDescription>
      </div>
      <Tag>{source(props.item, props.language)}</Tag>
    </div>

    <Show when={props.item.planState !== "active"}>
      <p class="provider-usage-meta">
        {props.language.t(
          props.item.planState === "past_due"
            ? "profile.usage.plan.pastDue"
            : props.item.planState === "canceling"
              ? "profile.usage.plan.canceling"
              : "profile.usage.plan.unknown",
        )}
      </p>
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
          return (
            <div class="provider-usage-row">
              <div class="provider-usage-row-heading">
                <span>{window.label}</span>
                <strong>{formatWindowValue(window, labels(props.language))}</strong>
              </div>
              <Show when={progress() !== undefined}>
                <Progress
                  value={progress()}
                  minValue={0}
                  maxValue={100}
                  aria-label={`${window.label}: ${formatWindowValue(window, labels(props.language))}`}
                />
              </Show>
              <Show when={window.resetAt}>
                {(reset) => (
                  <span class="provider-usage-meta">
                    {props.language.t("profile.usage.reset", { date: new Date(reset()).toLocaleString() })}
                  </span>
                )}
              </Show>
            </div>
          )
        }}
      </For>

      <For each={props.item.balances}>
        {(balance) => (
          <div class="provider-usage-row">
            <div class="provider-usage-row-heading">
              <span>{balance.label}</span>
              <strong>
                {balance.total} {balance.currency}
                {balance.available === false ? ` ${props.language.t("profile.usage.balance.unavailable")}` : ""}
              </strong>
            </div>
            <Show when={balance.granted !== undefined || balance.toppedUp !== undefined}>
              <span class="provider-usage-meta">
                {props.language.t("profile.usage.balance.breakdown", {
                  granted: balance.granted ?? props.language.t("profile.usage.status.unknown"),
                  toppedUp: balance.toppedUp ?? props.language.t("profile.usage.status.unknown"),
                })}
              </span>
            </Show>
          </div>
        )}
      </For>

      <For each={props.item.credits}>
        {(credit) => (
          <div class="provider-usage-row-heading">
            <span>{credit.label}</span>
            <strong>
              {credit.unlimited
                ? props.language.t("profile.usage.status.unlimited")
                : credit.balance !== undefined
                  ? `${credit.balance}${credit.unit ? ` ${credit.unit}` : ""}`
                  : credit.availableResets !== undefined
                    ? props.language.t("profile.usage.credits.resets", { count: String(credit.availableResets) })
                    : props.language.t("profile.usage.status.unknown")}
            </strong>
          </div>
        )}
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

const BillingCard: Component<{
  billing: NonNullable<ProviderUsageData["kiloBilling"]>
  onOpen: (url: string) => void
  language: Language
}> = (props) => (
  <Card class="provider-usage-card">
    <CardTitle icon={false}>{props.language.t("profile.usage.topups.title")}</CardTitle>
    <Show when={props.billing.autoTopUp}>
      {(auto) => (
        <div class="provider-usage-resources">
          <div class="provider-usage-row-heading">
            <span>{props.language.t("profile.usage.topups.auto")}</span>
            <strong>{props.language.t(auto().enabled ? "profile.usage.topups.on" : "profile.usage.topups.off")}</strong>
          </div>
          <p class="provider-usage-meta">
            {props.language.t("profile.usage.topups.rule", {
              amount: (auto().amountCents / 100).toFixed(2),
              threshold: (auto().thresholdCents / 100).toFixed(2),
            })}
            {auto().paymentLast4
              ? ` | ${props.language.t("profile.usage.topups.payment", {
                  brand: auto().paymentBrand ?? auto().paymentType ?? "Payment method",
                  last4: auto().paymentLast4 ?? "",
                })}`
              : ""}
          </p>
        </div>
      )}
    </Show>
    <Show when={props.billing.error}>
      <p class="provider-usage-notice">{props.language.t("profile.usage.state.unavailable")}</p>
    </Show>
    <CardActions>
      <Button variant="secondary" size="small" onClick={() => props.onOpen(props.billing.topUpUrl)}>
        {props.language.t("profile.usage.action.addCredits")}
      </Button>
      <Button variant="ghost" size="small" onClick={() => props.onOpen(props.billing.manageUrl)}>
        {props.language.t("profile.usage.action.manageBilling")}
      </Button>
    </CardActions>
  </Card>
)

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

      <Show
        when={props.data}
        fallback={
          <Show
            when={!props.loading && props.error}
            fallback={
              <div class="provider-usage-loading">
                <Spinner />
              </div>
            }
          >
            {(error) => (
              <Card variant="warning">
                <CardDescription>{error()}</CardDescription>
              </Card>
            )}
          </Show>
        }
      >
        {(data) => (
          <div class="provider-usage-list">
            <Show
              when={data().items.length > 0}
              fallback={
                <Card>
                  <CardDescription>{language.t("profile.usage.empty")}</CardDescription>
                </Card>
              }
            >
              <For each={data().items}>
                {(item) => <UsageCard item={item} onOpen={props.onOpen} language={language} />}
              </For>
            </Show>
            <Show when={data().kiloBilling}>
              {(billing) => <BillingCard billing={billing()} onOpen={props.onOpen} language={language} />}
            </Show>
          </div>
        )}
      </Show>
    </section>
  )
}
