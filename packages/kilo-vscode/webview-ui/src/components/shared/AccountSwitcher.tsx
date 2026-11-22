/**
 * AccountSwitcher component
 * Dropdown for switching between personal and organization accounts.
 * Placed in the welcome screen header, matching the legacy OrganizationSelector pattern.
 * Visible only when the user is logged in and belongs to at least one organization.
 */

import { Component, createSignal, createMemo, createEffect, For, Show, onCleanup } from "solid-js"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { useServer } from "../../context/server"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { BalanceChip } from "./BalanceChip"
import type { OrganizationSwitchResultMessage } from "../../types/messages"

/** One request lifecycle: idle, awaiting its correlated result, or failed with its target kept for retry. */
type Switch =
  | { kind: "idle" }
  | { kind: "switching"; requestID: string; target: string | null; origin: string | null }
  | { kind: "failed"; message: string; target: string | null; origin: string | null }

export const AccountSwitcher: Component<{ class?: string }> = (props) => {
  const server = useServer()
  const vscode = useVSCode()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [current, setSwitch] = createSignal<Switch>({ kind: "idle" })
  let ref: HTMLDivElement | undefined

  const profile = () => server.profileData()
  const orgs = () => profile()?.profile.organizations ?? []
  const personal = () => profile()?.profile.hasPersonalAccount !== false
  /** The account context the platform is scoped to; `null` means personal. */
  const active = () => profile()?.currentOrgId ?? null
  const visible = () => (!!profile() && (orgs().length > 0 || active() !== null)) || current().kind !== "idle"

  const selected = createMemo(() => orgs().find((org) => org.id === active()))

  const label = createMemo(() => {
    const org = selected()
    if (org) return org.name
    return language.t(active() === null ? "profile.personalAccount" : "profile.unavailableAccount")
  })

  const failure = createMemo(() => {
    const state = current()
    if (state.kind !== "failed") return undefined
    return state.message || language.t("profile.switchFailed")
  })

  const title = createMemo(() => {
    if (current().kind === "switching") return language.t("profile.switchingAccount")
    const failed = failure()
    if (failed) return failed
    const org = selected()
    if (org) return `${org.name} – ${org.role.toUpperCase()}`
    return language.t(active() === null ? "profile.personalAccount" : "profile.unavailableAccount")
  })

  // The result message owns termination: only the reply to the active request
  // may move the switcher, so a late reply from an abandoned attempt is ignored.
  function settle(result: OrganizationSwitchResultMessage) {
    const state = current()
    if (state.kind !== "switching" || state.requestID !== result.requestID) return
    if (result.ok) {
      setSwitch({ kind: "idle" })
      return
    }
    setSwitch({ kind: "failed", message: result.error ?? "", target: state.target, origin: state.origin })
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "organizationSwitchResult") {
      settle(message)
      return
    }
    if (message.type !== "profileData") return
    // A null profile means the session ended (logout or disconnect), so no
    // attempt may outlive it: a pending one would hang and a failed one would
    // show a retry to a signed-out user. `settle` ignores a late result once
    // the state is idle, so an answer that arrives later changes nothing.
    if (message.data === null) {
      if (current().kind !== "idle") setSwitch({ kind: "idle" })
      return
    }
    // A failed attempt ends only when a later profile read shows an account
    // other than the one it started from: a push that still reports the origin
    // leaves the attempt unconfirmed, while any other account means the applied
    // context moved on (here or in the other surface), so a stale alert and a
    // redundant retry cannot survive.
    const state = current()
    if (state.kind === "failed" && (message.data.currentOrgId ?? null) !== state.origin) setSwitch({ kind: "idle" })
  })
  onCleanup(unsubscribe)

  function submit(target: string | null) {
    const requestID = crypto.randomUUID()
    setSwitch({ kind: "switching", requestID, target, origin: active() })
    vscode.postMessage({ type: "setOrganization", organizationId: target, requestID })
  }

  function pick(target: string | null) {
    setOpen(false)
    if (target === active()) return
    submit(target)
  }

  function retry() {
    const state = current()
    if (state.kind !== "failed") return
    submit(state.target)
  }

  // Close on Escape or outside click
  createEffect(() => {
    if (!open()) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onMouse = (e: MouseEvent) => {
      if (ref && !ref.contains(e.target as Node)) setOpen(false)
    }

    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onMouse)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onMouse)
    })
  })

  const busy = () => current().kind === "switching"

  return (
    <Show when={visible()}>
      <div class={`account-switcher ${props.class ?? ""}`} ref={ref}>
        <button
          type="button"
          class={`account-switcher-trigger ${busy() ? "account-switcher-switching" : ""}`}
          onClick={() => setOpen((v) => !v)}
          disabled={busy()}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-busy={busy()}
          title={title()}
        >
          <span class="account-switcher-label">{label()}</span>
          <BalanceChip class="account-switcher-balance" />
          <span class="account-switcher-badges">
            <Show when={selected() && !busy()}>
              <span class="account-switcher-role">{selected()!.role.toUpperCase()}</span>
            </Show>
            <Show
              when={busy()}
              fallback={
                <svg
                  class={`account-switcher-chevron ${open() ? "open" : ""}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="rgb(156 163 175)"
                  aria-hidden="true"
                >
                  <path d="M3 4.5L6 7.5L9 4.5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              }
            >
              <Spinner style={{ width: "12px", height: "12px" }} />
            </Show>
          </span>
        </button>

        <Show when={failure()}>
          {(message) => (
            <div class="account-switcher-error" role="alert">
              <span class="account-switcher-error-text">{message()}</span>
              <button type="button" class="account-switcher-retry" onClick={retry}>
                {language.t("common.retry")}
              </button>
            </div>
          )}
        </Show>

        <Show when={open() && !busy()}>
          <div class="account-switcher-dropdown" role="listbox" aria-label="Account">
            <Show when={personal()}>
              <button
                type="button"
                role="option"
                aria-selected={active() === null}
                class="account-switcher-item"
                onClick={() => pick(null)}
              >
                <span class="account-switcher-item-name">{language.t("profile.personalAccount")}</span>
              </button>
            </Show>
            <For each={orgs()}>
              {(org) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={active() === org.id}
                  class="account-switcher-item"
                  onClick={() => pick(org.id)}
                >
                  <span class="account-switcher-item-name">{org.name}</span>
                  <span class="account-switcher-role">{org.role.toUpperCase()}</span>
                </button>
              )}
            </For>
            <Show when={active() !== null && !selected()}>
              <button
                type="button"
                role="option"
                aria-selected={true}
                class="account-switcher-item"
                disabled
                title={language.t("profile.unavailableAccount")}
              >
                <span class="account-switcher-item-name">{language.t("profile.unavailableAccount")}</span>
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
