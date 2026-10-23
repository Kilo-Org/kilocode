// Kilo `/usage` (U-E1-06): the cost and generation speed of the current session family, the Kilo coding plans and
// direct subscription quotas from the `kilocode.provider-usage` RPC, and the BYOK keys of the Kilo account. v1 showed
// the plans in `/usage` (packages/opencode/src/kilocode/components/dialog-provider-usage.tsx on main) and the session
// figures in the sidebar usage panel.
import { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Spinner } from "../component/spinner"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import {
  familyUsage,
  formatCacheRate,
  formatCost,
  formatCount,
  formatSpeed,
  formatWindow,
  windowLabel,
} from "./usage-data"

export function DialogUsage(props: { context: Plugin.Context; sessionID?: string }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const data = props.context.data
  const root = () => (props.sessionID ? data.session.root(props.sessionID) : undefined)
  const family = createMemo(() => {
    const id = root()
    if (!id) return []
    const members = data.session.family(id)
    return members.includes(id) ? members : [id, ...members]
  })
  const session = createMemo(() => {
    const id = root()
    const info = id ? data.session.get(id) : undefined
    if (!id || !info) return undefined
    const sessions = family().flatMap((member) => data.session.get(member) ?? [])
    return {
      cost: data.session.cost(id),
      subagents: sessions.length - 1,
      ...familyUsage(
        sessions,
        family().flatMap((member) => data.session.message.list(member)),
      ),
    }
  })
  const location = () => {
    const info = root() ? data.session.get(root()!) : undefined
    return { directory: (info?.location ?? props.context.location ?? data.location.default()).directory }
  }
  const usage = props.context.client.rpc(ProviderUsage.Definition)
  const gateway = props.context.client.rpc(KiloGatewayRpc.Definition)
  const [plans, setPlans] = createSignal<ProviderUsage.Info>()
  const [byok, setByok] = createSignal<readonly KiloGatewayRpc.ByokEntry[]>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal(false)

  const load = (force: boolean) => {
    if (loading()) return
    setLoading(true)
    setFailure(false)
    const options = { location: location() }
    void Promise.all([
      (force ? usage.refresh({}, options) : usage.get({}, options)).then(setPlans, () => setFailure(true)),
      // Signed out, the Gateway answers `unauthorized` and the BYOK list stays hidden.
      gateway.byok({}, options).then(setByok, () => setByok(undefined)),
    ]).finally(() => setLoading(false))
  }

  onMount(() => {
    dialog.setSize("xlarge")
    load(false)
    // Subagent messages are loaded on demand. The generation speed covers every step of the family.
    family().forEach((member) => void data.session.message.sync(member).catch(() => undefined))
  })

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "ctrl+r", title: "Refresh usage", group: "Dialog", run: () => load(true) }],
  }))

  const Row = (row: { label: string; value: string }) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.text.muted}>{row.label}</text>
      <text fg={theme.text.base}>{row.value}</text>
    </box>
  )

  return (
    <DialogLayout
      header={<DialogHeader title="Plans & usage" />}
      footer={{ actions: { primary: [{ title: "refresh", key: "ctrl+r", onTrigger: () => load(true) }] } }}
    >
      <scrollbox maxHeight={28} flexGrow={1}>
        <box gap={1}>
          <Show when={session()}>
            {(value) => (
              <box>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  Session
                </text>
                <Row
                  label={value().subagents > 0 ? `Cost (incl. ${value().subagents} subagents)` : "Cost"}
                  value={formatCost(value().cost)}
                />
                <Row label="Input tokens" value={formatCount(value().tokens.input)} />
                <Row label="Output tokens" value={formatCount(value().tokens.output)} />
                <Show when={value().tokens.reasoning > 0}>
                  <Row label="Reasoning tokens" value={formatCount(value().tokens.reasoning)} />
                </Show>
                <Row label="Cache read" value={formatCount(value().tokens.read)} />
                <Row label="Cache write" value={formatCount(value().tokens.write)} />
                <Row label="Cache hit rate" value={formatCacheRate(value().tokens)} />
                <Row label="Generation speed" value={formatSpeed(value().generation)} />
              </box>
            )}
          </Show>
          <box>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              Provider plans
            </text>
            <Show when={plans()}>
              {(value) => (
                <Show
                  when={value().items.length > 0}
                  fallback={<text fg={theme.text.muted}>No provider usage sources detected.</text>}
                >
                  <For each={value().items}>{(item) => <Item item={item} />}</For>
                </Show>
              )}
            </Show>
            <Show when={loading() && !plans()}>
              <Spinner />
            </Show>
            <Show when={failure()}>
              <text fg={theme.text.feedback.warning.base}>Provider usage could not be loaded.</text>
            </Show>
          </box>
          <Show when={byok()}>
            {(entries) => (
              <box>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  BYOK keys
                </text>
                <Show when={entries().length > 0} fallback={<text fg={theme.text.muted}>No BYOK keys.</text>}>
                  <For each={entries()}>
                    {(entry) => (
                      <Row
                        label={entry.provider_id}
                        value={[
                          entry.is_enabled ? "enabled" : "disabled",
                          entry.management_source === "coding_plan" ? "coding plan" : "user key",
                        ].join(" · ")}
                      />
                    )}
                  </For>
                </Show>
              </box>
            )}
          </Show>
        </box>
      </scrollbox>
    </DialogLayout>
  )
}

function Item(props: { item: ProviderUsage.UsageSnapshot }) {
  const theme = useTheme().surface("dialog")
  return (
    <box marginTop={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base}>
          {props.item.providerLabel} - {props.item.planLabel}
        </text>
        <text fg={theme.text.muted}>{props.item.sourceLabel}</text>
      </box>
      <text fg={props.item.fetchState === "ready" ? theme.text.muted : theme.text.feedback.warning.base}>
        {props.item.fetchState === "ready" ? props.item.planState : props.item.fetchState}
      </text>
      <Show when={props.item.fetchState === "ready" && props.item.windows.length === 0}>
        <text fg={theme.text.muted}>No usage limits reported.</text>
      </Show>
      <For each={props.item.windows}>
        {(window) => (
          <box>
            <text fg={theme.text.base}>
              {windowLabel(window)}: {formatWindow(window)}
            </text>
            <Show when={window.resetAt}>
              {(reset) => <text fg={theme.text.muted}>Resets {new Date(reset()).toLocaleString()}</text>}
            </Show>
          </box>
        )}
      </For>
      <Show when={props.item.routingState !== "not_applicable" && props.item.routingState !== "active"}>
        <text fg={theme.text.feedback.warning.base}>Routing: {props.item.routingState}</text>
      </Show>
      <Show when={props.item.error}>
        {(error) => <text fg={theme.text.feedback.warning.base}>{error().message}</text>}
      </Show>
      <Show when={props.item.managementUrl}>
        {(url) => (
          <box flexDirection="row">
            <text fg={theme.text.muted}>Manage: </text>
            <Link href={url()} fg={theme.text.base}>
              {url()}
            </Link>
          </box>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "kilocode.usage",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.usage",
              title: "Plans & usage",
              description: "View session usage, provider plans and quota",
              group: "Kilo",
              palette: true,
              slash: { name: "usage", aliases: ["plans", "quota"] },
              run: () => {
                const route = context.ui.router.current()
                context.ui.dialog.show(() => (
                  <DialogUsage context={context} sessionID={route.type === "session" ? route.sessionID : undefined} />
                ))
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
