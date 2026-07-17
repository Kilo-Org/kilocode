import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { ProviderUsage, ProviderUsageSnapshot, ProviderUsageWindow } from "@kilocode/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"
import { Spinner } from "@tui/component/spinner"
import { For, Show, createSignal, onMount } from "solid-js"

interface DialogProviderUsageProps {
  useSDK: () => { client: { kilocode: { providerUsage: { get(): Promise<unknown>; refresh(): Promise<unknown> } } } }
}

type Response = { data?: ProviderUsage; error?: unknown }

function amount(value: number, unit: string) {
  if (unit === "USD") return `$${value.toFixed(2)}`
  if (unit === "percent") return `${value.toFixed(value % 1 ? 1 : 0)}%`
  return `${value.toLocaleString()} ${unit === "count" ? "" : unit}`.trim()
}

export function formatWindow(window: ProviderUsageWindow) {
  if (window.state === "unlimited") return "Unlimited"
  if (window.state === "not_in_plan") return "Not in plan"
  if (window.state === "unknown") return "Unknown"
  if (window.orientation === "used_percent" && window.used !== undefined)
    return `${amount(window.used, "percent")} used`
  if (window.orientation === "remaining_percent" && window.remaining !== undefined)
    return `${amount(window.remaining, "percent")} remaining`
  if (window.remaining !== undefined && window.limit !== undefined)
    return `${amount(window.remaining, window.unit)} remaining of ${amount(window.limit, window.unit)}`
  if (window.used !== undefined && window.limit !== undefined)
    return `${amount(window.used, window.unit)} used of ${amount(window.limit, window.unit)}`
  return window.state === "exhausted" ? "Exhausted" : "Unknown"
}

function Item(props: { item: ProviderUsageSnapshot }) {
  const { theme } = useTheme()
  return (
    <box border={true} borderColor={theme.border} paddingLeft={1} paddingRight={1} marginBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.item.providerLabel} - {props.item.planLabel}
        </text>
        <text fg={theme.textMuted}>{props.item.sourceLabel}</text>
      </box>
      <text fg={props.item.fetchState === "ready" ? theme.textMuted : theme.warning}>
        {props.item.fetchState === "ready" ? props.item.planState : props.item.fetchState}
      </text>
      <Show
        when={props.item.windows.length === 0 && props.item.balances.length === 0 && props.item.credits.length === 0}
      >
        <text fg={theme.textMuted}>No usage details reported by provider for this plan.</text>
      </Show>
      <For each={props.item.windows}>
        {(window) => (
          <box>
            <text fg={theme.text}>
              {window.label}: {formatWindow(window)}
            </text>
            <Show when={window.resetAt}>
              {(reset) => <text fg={theme.textMuted}>Resets {new Date(reset()).toLocaleString()}</text>}
            </Show>
          </box>
        )}
      </For>
      <For each={props.item.balances}>
        {(balance) => (
          <box>
            <text fg={theme.text}>
              {balance.label}: {balance.total} {balance.currency}
              {balance.available === false ? " (unavailable)" : ""}
            </text>
            <Show when={balance.granted !== undefined || balance.toppedUp !== undefined}>
              <text fg={theme.textMuted}>
                Granted {balance.granted ?? "unknown"} | Topped up {balance.toppedUp ?? "unknown"}
              </text>
            </Show>
          </box>
        )}
      </For>
      <For each={props.item.credits}>
        {(credit) => (
          <text fg={theme.text}>
            {credit.label}:{" "}
            {credit.unlimited
              ? "Unlimited"
              : credit.balance !== undefined
                ? `${credit.balance} ${credit.unit ?? ""}`
                : credit.availableResets !== undefined
                  ? `${credit.availableResets} resets`
                  : "Unknown"}
          </text>
        )}
      </For>
      <Show when={props.item.routingState !== "not_applicable" && props.item.routingState !== "active"}>
        <text fg={theme.warning}>Routing: {props.item.routingState}</text>
      </Show>
      <Show when={props.item.error}>{(error) => <text fg={theme.warning}>{error().message}</text>}</Show>
      <Show when={props.item.managementUrl}>
        {(url) => (
          <box flexDirection="row">
            <text fg={theme.textMuted}>Manage: </text>
            <Link href={url()} fg={theme.primary}>
              {url()}
            </Link>
          </box>
        )}
      </Show>
    </box>
  )
}

export function ProviderUsageBody(props: { data: ProviderUsage }) {
  const { theme } = useTheme()
  return (
    <box>
      <Show
        when={props.data.items.length > 0}
        fallback={<text fg={theme.textMuted}>No provider usage sources detected.</text>}
      >
        <For each={props.data.items}>{(item) => <Item item={item} />}</For>
      </Show>
      <Show when={props.data.kiloBilling}>
        {(billing) => (
          <box border={true} borderColor={theme.border} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Personal top-ups
            </text>
            <Show when={billing().autoTopUp}>
              {(auto) => (
                <text fg={theme.text}>
                  Auto-top-up: {auto().enabled ? "On" : "Off"} - ${(auto().amountCents / 100).toFixed(2)} at $
                  {(auto().thresholdCents / 100).toFixed(2)}
                  {auto().paymentLast4
                    ? ` - ${auto().paymentBrand ?? auto().paymentType ?? "payment method"} ending ${auto().paymentLast4}`
                    : ""}
                </text>
              )}
            </Show>
            <Show when={billing().error}>{(error) => <text fg={theme.warning}>{error().message}</text>}</Show>
            <box flexDirection="row" gap={2}>
              <Link href={billing().topUpUrl} fg={theme.primary}>
                Add credits
              </Link>
              <Link href={billing().manageUrl} fg={theme.primary}>
                Manage billing
              </Link>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}

export function DialogProviderUsage(props: DialogProviderUsageProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = props.useSDK()
  const [data, setData] = createSignal<ProviderUsage>()
  const [loading, setLoading] = createSignal(true)
  const [failure, setFailure] = createSignal<string>()

  async function load(force: boolean) {
    if (loading() && data()) return
    setLoading(true)
    setFailure(undefined)
    const response = (await (force
      ? sdk.client.kilocode.providerUsage.refresh().catch(() => undefined)
      : sdk.client.kilocode.providerUsage.get().catch(() => undefined))) as Response | undefined
    if (response?.data) setData(response.data)
    if (response?.error || !response?.data) setFailure("Provider usage could not be loaded.")
    setLoading(false)
  }

  onMount(() => {
    dialog.setSize("xlarge")
    void load(false)
  })

  useKeyboard((event) => {
    if (event.ctrl && event.name === "r") void load(true)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Plans & usage
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <scrollbox height={24}>
        <Show when={data()}>{(value) => <ProviderUsageBody data={value()} />}</Show>
        <Show when={loading() && !data()}>
          <Spinner />
        </Show>
        <Show when={failure()}>{(message) => <text fg={theme.warning}>{message()}</text>}</Show>
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <text fg={loading() ? theme.textMuted : theme.primary} onMouseUp={() => !loading() && void load(true)}>
          refresh ctrl+r
        </text>
      </box>
    </box>
  )
}
