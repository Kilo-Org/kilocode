import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { ProviderUsage, ProviderUsageSnapshot } from "@kilocode/sdk/v2"
import { formatWindow, windowLabel } from "@kilocode/kilo-gateway/provider-usage"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"
import { Spinner } from "@tui/component/spinner"
import { For, Show, createSignal, onMount } from "solid-js"

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
      <For each={props.item.windows}>
        {(window) => (
          <box>
            <text fg={theme.text}>
              {windowLabel(window)}: {formatWindow(window)}
            </text>
            <Show when={window.resetAt}>
              {(reset) => <text fg={theme.textMuted}>Resets {new Date(reset()).toLocaleString()}</text>}
            </Show>
          </box>
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

function ProviderUsageBody(props: { data: ProviderUsage }) {
  const { theme } = useTheme()
  return (
    <box>
      <Show
        when={props.data.items.length > 0}
        fallback={<text fg={theme.textMuted}>No provider usage sources detected.</text>}
      >
        <For each={props.data.items}>{(item) => <Item item={item} />}</For>
      </Show>
    </box>
  )
}

export function DialogProviderUsage() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const [data, setData] = createSignal<ProviderUsage>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()

  async function load(force: boolean) {
    if (loading()) return
    setLoading(true)
    setFailure(undefined)
    const response = await (force
      ? sdk.client.kilocode.providerUsage.refresh().catch(() => undefined)
      : sdk.client.kilocode.providerUsage.get().catch(() => undefined))
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
      <scrollbox maxHeight={24} flexGrow={1}>
        <box>
          <Show when={data()}>{(value) => <ProviderUsageBody data={value()} />}</Show>
          <Show when={loading() && !data()}>
            <Spinner />
          </Show>
          <Show when={failure()}>{(message) => <text fg={theme.warning}>{message()}</text>}</Show>
        </box>
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <text fg={loading() ? theme.textMuted : theme.primary} onMouseUp={() => !loading() && void load(true)}>
          refresh ctrl+r
        </text>
      </box>
    </box>
  )
}
