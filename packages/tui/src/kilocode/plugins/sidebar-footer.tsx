// Kilo TUI sidebar balance, ported from v1 `packages/opencode/src/kilocode/plugins/sidebar-footer.tsx`:
// the wallet of the active Kilo account, the Kilo Pass sub-rows of the personal scope, the refresh
// policy, and the "Kilo <version>" line below the upstream footer. The getting-started box and the
// path line stay in the upstream footer. v1 privacy mode is not ported: v2 has no privacy_mode config.
import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js"

const TEAM_POLL_MS = 5 * 60_000
const BILLED_REFRESH_MS = 10_000
const REFRESH_TIMEOUT_MS = 30_000

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type Pass = NonNullable<KiloGatewayRpc.KiloPass>

type State = {
  balance?: number
  scope: ReturnType<typeof scope>
  pass: Pass | null
}

export function format(value: number) {
  return usd.format(value)
}

export function scope(org: string | null | undefined, list?: readonly { id: string; name: string }[]) {
  if (!org) {
    return { kind: "Personal" as const }
  }
  return {
    kind: "Team" as const,
    name: list?.find((item) => item.id === org)?.name,
  }
}

export function creditLabel(value: ReturnType<typeof scope>) {
  if (value.kind === "Personal") return "Personal credits"
  return value.name ? `${value.name} team` : "Team credits"
}

const short = (value: number) => "$" + Math.round(value)

// Pass credits are part of the personal balance, so we show this period's usage against the base allotment.
export function passLine(pass: Pass) {
  return `${short(pass.currentPeriodUsageUsd)} / ${short(pass.currentPeriodBaseCreditsUsd)}`
}

export function resetLabel(iso?: string | null) {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date)
}

// A billed step: a completed Kilo assistant message with a non-zero cost.
export function billable(info: SessionMessageInfo) {
  if (info.type !== "assistant") return false
  return info.model.providerID === "kilo" && info.time.completed !== undefined && (info.cost ?? 0) > 0
}

function View(props: { context: Plugin.Context }) {
  const theme = () => props.context.theme
  const rpc = props.context.client.rpc(KiloGatewayRpc.Definition)
  const [state, setState] = createSignal<State>()
  let seq = 0
  let inflight: AbortController | undefined
  let teamPoll: ReturnType<typeof setInterval> | undefined
  const wallet = createMemo(() => {
    const data = state()
    if (!data) return undefined
    if (data.balance !== undefined) return data
    if (data.scope.kind === "Personal" && data.pass) return data
    return undefined
  })
  const tone = createMemo(() => {
    const value = state()?.balance
    return value !== undefined && value <= 2 ? theme().text.feedback.error.base : theme().text.muted
  })
  const personalPass = createMemo(() => {
    const data = wallet()
    if (!data || data.scope.kind !== "Personal") return null
    return data.pass
  })
  const location = (): LocationRef => props.context.location ?? props.context.data.location.default()
  // Signed out, the Gateway has no wallet, so the panel sends no request.
  const signedIn = createMemo(() =>
    (props.context.data.location.integration.list(location()) ?? []).some(
      (item) => item.id === "kilo" && item.connections.length > 0,
    ),
  )
  const refresh = () => {
    const id = ++seq
    if (!signedIn()) {
      inflight?.abort()
      clearInterval(teamPoll)
      setState(undefined)
      return
    }
    // Cancel any prior request and time this one out. The client path has no fetch timeout, so a stalled
    // Gateway call would otherwise leak the in-flight request and its closure.
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
    const options = { location: { directory: location().directory }, signal: controller.signal }
    void Promise.all([rpc.profile({}, options), rpc.balance({}, options), rpc.kiloPass({}, options).catch(() => null)])
      .then((result) => {
        if (id !== seq) return
        // Show the wallet whenever authenticated. An empty or zero balance is real data, not "still loading".
        const next: State = {
          balance: result[1].balance ?? undefined,
          scope: scope(result[0].organizationID, result[0].organizations),
          pass: result[2] ?? null,
        }
        setState(next)
        // Team balances move with other members' usage, so poll while on a team; personal updates on spend.
        clearInterval(teamPoll)
        teamPoll = next.scope.kind === "Team" ? setInterval(refresh, TEAM_POLL_MS) : undefined
      })
      .catch(() => {
        if (id !== seq) return
        setState(undefined)
      })
      .finally(() => {
        clearTimeout(timeout)
        if (inflight === controller) inflight = undefined
      })
  }

  createEffect(on(signedIn, refresh))
  onMount(() => {
    // Switching org via /teams publishes this, so the balance updates immediately.
    onCleanup(rpc.events.on("organization", () => refresh()))
    // Refresh shortly after a billed turn so the balance reflects new spend. The store applies the event
    // before this handler, so the assistant message already carries the completed time and cost.
    let billed: ReturnType<typeof setTimeout> | undefined
    onCleanup(
      props.context.data.on("session.step.ended", (event) => {
        const info = props.context.data.session.message.get(event.data.sessionID, event.data.assistantMessageID)
        if (!info || !billable(info)) return
        clearTimeout(billed)
        billed = setTimeout(refresh, BILLED_REFRESH_MS)
      }),
    )
    onCleanup(() => {
      clearTimeout(billed)
      clearInterval(teamPoll)
      inflight?.abort()
    })
  })

  return (
    <Show when={wallet()}>
      {(data) => (
        <box gap={0}>
          <text fg={theme().text.base}>
            <b>Balance</b>
          </text>
          <Show when={data().balance !== undefined}>
            <box flexDirection="row" justifyContent="space-between">
              <box flexDirection="row" gap={1}>
                <text fg={tone()}>•</text>
                <text fg={theme().text.base}>
                  <b>{creditLabel(data().scope)}</b>
                </text>
              </box>
              <text fg={tone()}>{format(data().balance ?? 0)}</text>
            </box>
          </Show>
          <Show when={personalPass()}>
            {(pass) => (
              <box gap={0}>
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={theme().text.muted}>{" └ Kilo Pass"}</text>
                  <text fg={theme().text.muted}>{passLine(pass())}</text>
                </box>
                <Show when={pass().currentPeriodBonusCreditsUsd > 0}>
                  <box flexDirection="row" justifyContent="space-between" gap={1}>
                    <text fg={theme().text.muted}>{"    Bonus"}</text>
                    <text fg={theme().text.muted}>{"+" + format(pass().currentPeriodBonusCreditsUsd)}</text>
                  </box>
                </Show>
                <Show when={resetLabel(pass().nextBillingAt)}>
                  {(date) => (
                    <box flexDirection="row" justifyContent="space-between" gap={1}>
                      <text fg={theme().text.muted}>{"    Renews"}</text>
                      <text fg={theme().text.muted}>{date()}</text>
                    </box>
                  )}
                </Show>
              </box>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "kilocode.sidebar.footer",
  setup(context) {
    context.ui.slot({
      append: "sidebar.footer",
      order: 99,
      render: () => <View context={context} />,
    })
    // The version line sits below the upstream footer (location path), as the last v1 footer line.
    context.ui.slot({
      append: "sidebar.footer",
      order: 101,
      render: () => (
        <text fg={context.theme.text.muted}>
          <span style={{ fg: context.theme.text.feedback.success.base }}>•</span>{" "}
          <span style={{ fg: context.theme.text.base }}>
            <b>Kilo</b>
          </span>{" "}
          <span>{context.app.version}</span>
        </text>
      ),
    })
  },
})
