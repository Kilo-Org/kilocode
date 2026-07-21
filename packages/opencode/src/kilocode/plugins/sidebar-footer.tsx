import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { KiloPassState } from "@kilocode/kilo-gateway"
import type { Message } from "@kilocode/sdk/v2"
import { onBalanceRefresh } from "../balance-refresh"
import { REDACTED_BALANCE } from "../pii"

const id = "internal:kilo-sidebar-footer"
const TEAM_POLL_MS = 5 * 60_000
const BILLED_REFRESH_MS = 10_000
const REFRESH_TIMEOUT_MS = 30_000
const log = Log.create({ service: "sidebar-footer" })

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

type State = {
  balance?: number
  scope: ReturnType<typeof scope>
  pass: KiloPassState | null
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

export function creditLabel(value: ReturnType<typeof scope>, masked = false) {
  if (value.kind === "Personal") return "Personal credits"
  if (masked) return "Team credits"
  return value.name ? `${value.name} team` : "Team credits"
}

const short = (value: number) => "$" + Math.round(value)

// Pass credits are part of the personal balance, so we show this period's usage against the base allotment.
export function passLine(pass: KiloPassState) {
  return `${short(pass.currentPeriodUsageUsd)} / ${short(pass.currentPeriodBaseCreditsUsd)}`
}

export function resetLabel(iso?: string | null) {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date)
}

// A billed turn: a completed Kilo assistant message with a non-zero cost.
export function billable(info: Message) {
  if (info.role !== "assistant") return false
  return info.providerID === "kilo" && info.time.completed !== undefined && info.cost > 0
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [state, setState] = createSignal<State>()
  let seq = 0
  let inflight: AbortController | undefined
  let teamPoll: ReturnType<typeof setInterval> | undefined
  const has = createMemo(() =>
    props.api.state.provider.some(
      (item) =>
        (item.id !== "opencode" && item.id !== "kilo") ||
        Object.values(item.models).some((model) => model.cost?.input !== 0),
    ),
  )
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const wallet = createMemo(() => {
    const data = state()
    if (!data) return undefined
    if (data.balance !== undefined) return data
    if (data.scope.kind === "Personal" && data.pass) return data
    return undefined
  })
  const tone = createMemo(() => {
    const value = state()?.balance
    return value !== undefined && value <= 2 ? theme().error : theme().textMuted
  })
  const path = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const text = props.api.state.vcs?.branch ? out + ":" + props.api.state.vcs.branch : out
    const list = text.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
    }
  })
  const privacyMode = createMemo(() => props.api.state.config.privacy_mode === true)
  const balanceText = createMemo(() => (privacyMode() ? REDACTED_BALANCE : null))
  const refresh = () => {
    const id = ++seq
    // Cancel any prior request and time this one out — the client path has no fetch timeout,
    // so a stalled Gateway call would otherwise leak the in-flight request and its closure.
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
    void props.api.client.kilo
      .profile(undefined, { signal: controller.signal })
      .then((res) => {
        if (id !== seq) return
        if (res.error || !res.data) {
          setState(undefined)
          return
        }
        // Show the wallet whenever authenticated — an empty/zero balance is real data, not "still loading".
        const next: State = {
          balance: res.data.balance?.balance,
          scope: scope(res.data.currentOrgId, res.data.profile.organizations),
          pass: res.data.kiloPass ?? null,
        }
        setState(next)
        // Team balances move with other members' usage, so poll while on a team; personal updates on spend.
        clearInterval(teamPoll)
        teamPoll = next.scope.kind === "Team" ? setInterval(refresh, TEAM_POLL_MS) : undefined
      })
      .catch((err) => {
        if (id !== seq) return
        setState(undefined)
        log.debug("balance refresh failed", { err })
      })
      .finally(() => {
        clearTimeout(timeout)
        if (inflight === controller) inflight = undefined
      })
  }

  onMount(() => {
    refresh()
    // Switching org via /teams fires this, so the balance updates immediately.
    onCleanup(onBalanceRefresh(refresh))
    // Refresh shortly after a billed turn so the balance reflects new spend.
    let billed: ReturnType<typeof setTimeout> | undefined
    onCleanup(
      props.api.event.on("message.updated", (event) => {
        if (!billable(event.properties.info)) return
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
    <box gap={1}>
      <Show when={wallet()}>
        {(data) => (
          <box gap={0}>
            <text fg={theme().text}>
              <b>Balance</b>
            </text>
            {(() => {
              const balance = data().balance
              if (balance === undefined) return null
              const masked = balanceText()
              return (
                <box flexDirection="row" justifyContent="space-between">
                  <box flexDirection="row" gap={1}>
                    <text fg={tone()}>•</text>
                    <text fg={theme().text}>
                      <b>{creditLabel(data().scope, privacyMode())}</b>
                    </text>
                  </box>
                  <text fg={tone()}>{masked ?? format(balance)}</text>
                </box>
              )
            })()}
            <Show when={privacyMode() ? null : data().scope.kind === "Personal" ? data().pass : null}>
              {(pass) => (
                <box gap={0}>
                  <box flexDirection="row" justifyContent="space-between" gap={1}>
                    <text fg={theme().textMuted}>{" └ Kilo Pass"}</text>
                    <text fg={theme().textMuted}>{passLine(pass())}</text>
                  </box>
                  <Show when={pass().currentPeriodBonusCreditsUsd > 0}>
                    <box flexDirection="row" justifyContent="space-between" gap={1}>
                      <text fg={theme().textMuted}>{"    Bonus"}</text>
                      <text fg={theme().textMuted}>{"+" + format(pass().currentPeriodBonusCreditsUsd)}</text>
                    </box>
                  </Show>
                  <Show when={resetLabel(pass().nextBillingAt)}>
                    {(date) => (
                      <box flexDirection="row" justifyContent="space-between" gap={1}>
                        <text fg={theme().textMuted}>{"    Renews"}</text>
                        <text fg={theme().textMuted}>{date()}</text>
                      </box>
                    )}
                  </Show>
                </box>
              )}
            </Show>
          </box>
        )}
      </Show>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>Kilo includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <span style={{ fg: theme().text }}>{path().name}</span>
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span>{" "}
        <span style={{ fg: theme().text }}>
          <b>Kilo</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 99,
    slots: {
      sidebar_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
