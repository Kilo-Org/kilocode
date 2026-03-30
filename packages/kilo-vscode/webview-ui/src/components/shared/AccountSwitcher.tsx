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

const PERSONAL = "personal"

export const AccountSwitcher: Component<{ class?: string }> = (props) => {
  const server = useServer()
  const vscode = useVSCode()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [switching, setSwitching] = createSignal(false)
  let ref: HTMLDivElement | undefined

  const profile = () => server.profileData()
  const orgs = () => profile()?.profile.organizations ?? []
  const visible = () => !!profile() && orgs().length > 0
  const current = () => profile()?.currentOrgId ?? PERSONAL

  const selected = createMemo(() => {
    const id = current()
    if (id === PERSONAL) return undefined
    return orgs().find((o) => o.id === id)
  })

  const label = createMemo(() => selected()?.name ?? language.t("profile.personalAccount"))

  // Clear switching state when profile data changes (switch completed or failed)
  createEffect(() => {
    profile()
    setSwitching(false)
  })

  function pick(org: { id: string; name: string; role: string } | null) {
    if (org?.id === current() || (!org && current() === PERSONAL)) {
      setOpen(false)
      return
    }
    setSwitching(true)
    vscode.postMessage({
      type: "setOrganization",
      organizationId: org?.id ?? null,
    })
    setOpen(false)
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

  return (
    <Show when={visible()}>
      <div class={`account-switcher ${props.class ?? ""}`} ref={ref}>
        <button
          type="button"
          class={`account-switcher-trigger ${switching() ? "account-switcher-switching" : ""}`}
          onClick={() => !switching() && setOpen((v) => !v)}
          disabled={switching()}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-busy={switching()}
          title={
            switching()
              ? language.t("profile.switchingAccount")
              : selected()
                ? `${selected()!.name} – ${selected()!.role.toUpperCase()}`
                : language.t("profile.personalAccount")
          }
        >
          <span class="account-switcher-label">{label()}</span>
          <span class="account-switcher-badges">
            <Show when={selected() && !switching()}>
              <span class="account-switcher-role">{selected()!.role.toUpperCase()}</span>
            </Show>
            <Show
              when={switching()}
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

        <Show when={open() && !switching()}>
          <div class="account-switcher-dropdown" role="listbox" aria-label="Account">
            <button
              type="button"
              role="option"
              aria-selected={current() === PERSONAL}
              class="account-switcher-item"
              onClick={() => pick(null)}
            >
              <span class="account-switcher-item-name">{language.t("profile.personalAccount")}</span>
            </button>
            <For each={orgs()}>
              {(org) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={current() === org.id}
                  class="account-switcher-item"
                  onClick={() => pick(org)}
                >
                  <span class="account-switcher-item-name">{org.name}</span>
                  <span class="account-switcher-role">{org.role.toUpperCase()}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
