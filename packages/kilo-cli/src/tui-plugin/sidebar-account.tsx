import {
  createClient,
  type KiloGatewayAccount,
  type KiloGatewayAccountBalance,
  type RpcCallOptions,
} from "@kilocode/client"
import type { LocationRef } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import {
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  Match,
  Show,
  Switch,
} from "solid-js"

const TEAM_REFRESH_MS = 60_000

export type AccountSidebarClient = Pick<ReturnType<typeof createClient>, "kilocode">

export type AccountSidebarOptions = {
  readonly client?: AccountSidebarClient
  readonly account: Accessor<KiloGatewayAccount | undefined>
  readonly privacy: Accessor<boolean>
  /** Increments for every profile refresh, including same-organization account changes. */
  readonly revision: Accessor<number>
  readonly signal?: AbortSignal
}

type State =
  | { readonly kind: "signed-out" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly data: KiloGatewayAccountBalance }

/** Append authenticated Kilo credits to the active native session sidebar. */
export function installAccountSidebar(ctx: Plugin.Context, options: AccountSidebarOptions) {
  ctx.ui.slot({
    append: "sidebar.footer",
    render: (props) => <AccountSidebar context={ctx} sessionID={props.sessionID} {...options} />,
  })
}

export function AccountSidebar(
  props: AccountSidebarOptions & { readonly context: Plugin.Context; readonly sessionID: string },
) {
  const theme = props.context.theme
  const location = createMemo(() => props.context.data.session.get(props.sessionID)?.location ?? props.context.location)
  const identity = createMemo(() =>
    accountRequestIdentity(props.account(), props.revision(), props.sessionID, location()),
  )
  const [state, setState] = createSignal<State>({ kind: "signed-out" })
  const data = createMemo(() => {
    const current = state()
    if (current.kind === "ready") return current.data
    return undefined
  })
  let sequence = 0
  let controller: AbortController | undefined

  const refresh = async () => {
    controller?.abort()
    const account = props.account()
    const ref = location()
    const current = ++sequence
    if (!account) {
      setState({ kind: "signed-out" })
      return
    }
    if (!account.selectionAvailable || !ref || !props.client) {
      setState({ kind: "unavailable" })
      return
    }
    controller = new AbortController()
    const signal = props.signal ? AbortSignal.any([controller.signal, props.signal]) : controller.signal
    setState({ kind: "loading" })
    try {
      const value = await props.client.kilocode.balance(requestOptions(ref, signal))
      if (current !== sequence || signal.aborted) return
      if (value.currentOrganizationID !== account.currentOrganizationID) {
        setState({ kind: "unavailable" })
        return
      }
      setState({ kind: "ready", data: value })
    } catch {
      if (current !== sequence || signal.aborted) return
      setState({ kind: "unavailable" })
    }
  }

  createRenderEffect(on(identity, () => void refresh()))

  createEffect(() => {
    const account = props.account()
    props.revision()
    if (account?.currentOrganizationID === null && account.selectionAvailable) return
    if (!account?.currentOrganizationID || !account.selectionAvailable) return
    const timer = setInterval(() => void refresh(), TEAM_REFRESH_MS)
    onCleanup(() => clearInterval(timer))
  })

  const stopExecutionEvents = props.context.data.on("session.execution.succeeded", (event) => {
    if (event.data.sessionID !== props.sessionID) return
    const ref = location()
    if (
      ref &&
      event.location &&
      (event.location.directory !== ref.directory || event.location.workspaceID !== ref.workspaceID)
    )
      return
    void refresh()
  })
  onCleanup(() => {
    sequence++
    controller?.abort()
    stopExecutionEvents()
  })

  return (
    <box gap={0}>
      <text fg={theme.text.default}>
        <b>Credits</b>
      </text>
      <Switch>
        <Match when={state().kind === "signed-out"}>
          <text fg={theme.text.subdued}>Sign in to view credits</text>
        </Match>
        <Match when={state().kind === "loading"}>
          <text fg={theme.text.subdued}>Loading</text>
        </Match>
        <Match when={state().kind === "unavailable"}>
          <text fg={theme.text.feedback.warning.default}>Unavailable</text>
        </Match>
        <Match when={data()}>
          <Show when={data()}>
            {(value) => (
              <>
                <Show when={value().balance}>
                  {(balance) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text.default}>
                        <b>{creditLabel(props.account(), props.privacy())}</b>
                      </text>
                      <text fg={theme.text.subdued}>{props.privacy() ? "•••" : currency(balance().balance)}</text>
                    </box>
                  )}
                </Show>
                <Show when={value().balance === null}>
                  <text fg={theme.text.feedback.warning.default}>Unavailable</text>
                </Show>
                <Show when={!props.privacy() && value().currentOrganizationID === null ? value().kiloPass : undefined}>
                  {(pass) => (
                    <>
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.text.subdued}>└ Kilo Pass</text>
                        <text fg={theme.text.subdued}>
                          {`${currency(pass().currentPeriodUsageUsd)} / ${currency(pass().currentPeriodBaseCreditsUsd)}`}
                        </text>
                      </box>
                      <Show when={pass().currentPeriodBonusCreditsUsd > 0}>
                        <box flexDirection="row" justifyContent="space-between">
                          <text fg={theme.text.subdued}> Bonus</text>
                          <text fg={theme.text.subdued}>{`+${currency(pass().currentPeriodBonusCreditsUsd)}`}</text>
                        </box>
                      </Show>
                      <Show when={renewal(pass().nextBillingAt)}>
                        {(date) => (
                          <box flexDirection="row" justifyContent="space-between">
                            <text fg={theme.text.subdued}> Renews</text>
                            <text fg={theme.text.subdued}>{date()}</text>
                          </box>
                        )}
                      </Show>
                    </>
                  )}
                </Show>
              </>
            )}
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

export function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
}

export function creditLabel(account: KiloGatewayAccount | undefined, privacy: boolean) {
  if (account?.currentOrganizationID === null) return "Personal credits"
  if (privacy) return "Team credits"
  return account?.profile.organizations.find((item) => item.id === account.currentOrganizationID)?.name
    ? `${account.profile.organizations.find((item) => item.id === account.currentOrganizationID)?.name} team`
    : "Team credits"
}

export function renewal(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return undefined
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value))
}

function requestOptions(location: LocationRef, signal: AbortSignal): RpcCallOptions {
  return {
    signal,
    location: {
      directory: location.directory,
      ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
    },
  }
}

export function accountRequestIdentity(
  account: KiloGatewayAccount | undefined,
  revision: number,
  sessionID: string,
  location: LocationRef | undefined,
) {
  return [
    revision,
    sessionID,
    location?.directory ?? "",
    location?.workspaceID ?? "",
    account?.currentOrganizationID ?? "personal",
    account?.selectionAvailable ?? false,
  ].join("\u0000")
}
