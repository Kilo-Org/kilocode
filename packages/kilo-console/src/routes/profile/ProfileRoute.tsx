import { A, useLocation, useNavigate } from "@solidjs/router"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { LoadingScreen } from "../../components/LoadingScreen"
import { loadKiloProfile, logoutKilo, setKiloOrganization, type KiloProfileData, type ProjectQuery } from "../../client"
import { errMsg } from "../../shared/utils"
import {
  authError,
  cloud,
  credits,
  initials,
  markDisconnected,
  money,
  page,
  personal,
  usage,
  wasDisconnected,
} from "./profile-utils"
import { useProfileServer } from "./server"

type Org = NonNullable<KiloProfileData["profile"]["organizations"]>[number]
type State = { kind: "connected"; data: KiloProfileData } | { kind: "disconnected" }

async function load(input: ProjectQuery): Promise<State> {
  if (wasDisconnected()) return { kind: "disconnected" }
  try {
    const data = await loadKiloProfile(input)
    markDisconnected(false)
    return { kind: "connected", data }
  } catch (err) {
    if (authError(err)) {
      markDisconnected(true)
      return { kind: "disconnected" }
    }
    throw err
  }
}

function org(data: KiloProfileData | undefined) {
  if (!data?.currentOrgId) return undefined
  return data.profile.organizations?.find((item) => item.id === data.currentOrgId)
}

function account(data: KiloProfileData | undefined) {
  return org(data)?.name ?? "Personal Account"
}

function role(input: Org) {
  if (input.role === "owner") return "Owner"
  if (input.role === "admin") return "Admin"
  if (input.role === "billing_manager") return "Billing"
  return "Member"
}

export function ProfileRoute() {
  const loc = useLocation()
  const nav = useNavigate()
  const params = createMemo(() => new URLSearchParams(loc.search))
  const server = useProfileServer(params)
  const [data, actions] = createResource(server.query, load)
  const [saving, setSaving] = createSignal<string>()
  const [error, setError] = createSignal("")
  const profile = createMemo(() => {
    const state = data()
    if (state?.kind === "connected") return state.data
    return undefined
  })
  const orgs = createMemo(() => profile()?.profile.organizations ?? [])
  const active = createMemo(() => org(profile()))
  const disconnected = createMemo(() => data()?.kind === "disconnected")
  const scope = createMemo(() => {
    if (profile()) return account(profile())
    if (data.loading) return "Loading..."
    return "Not connected"
  })
  const login = () => page(params(), "/kilo/login")
  const overview = () => page(params(), "/profile")
  const usageUrl = createMemo(() => usage(profile()?.currentOrgId))
  const creditsUrl = createMemo(() => credits(profile()?.currentOrgId))

  createEffect(() => {
    if (profile()) server.remember()
  })

  createEffect(() => {
    const err = data.error
    if (!err || authError(err)) return
    server.recover()
  })

  function refresh() {
    setError("")
    void actions.refetch()
  }

  function choose(id: string | null) {
    const current = server.query()
    if (!current) return
    const next = id ?? personal
    const selected = profile()?.currentOrgId ?? null
    if (selected === id) return
    setSaving(next)
    setError("")
    void setKiloOrganization(current, id)
      .then(() => actions.refetch())
      .catch((err) => setError(errMsg(err)))
      .finally(() => setSaving(undefined))
  }

  function logout() {
    const current = server.query()
    if (!current) return
    setSaving("logout")
    setError("")
    void logoutKilo(current)
      .then(() => {
        markDisconnected(true)
        actions.mutate({ kind: "disconnected" })
        nav(overview(), { replace: true })
      })
      .catch((err) => setError(errMsg(err)))
      .finally(() => setSaving(undefined))
  }

  return (
    <section class="config-shell profile-shell" classList={{ disconnected: disconnected() }}>
      <Show when={!disconnected()}>
        <aside class="config-sidebar" aria-label="Profile sections">
          <div class="config-sidebar-title">
            <span>Profile</span>
            <span class="config-sidebar-scope">
              <span>{scope()}</span>
            </span>
          </div>
          <nav class="config-options">
            <A class="config-top-option active" href={overview()} aria-current="page">
              <span>Overview</span>
            </A>
            <a class="config-top-option" href={usageUrl()} target="_blank" rel="noreferrer">
              <span>Usage</span>
            </a>
            <a class="config-top-option" href={creditsUrl()} target="_blank" rel="noreferrer">
              <span>Buy Credits</span>
            </a>
          </nav>
        </aside>
      </Show>
      <section class="content">
        <div class="profile-page">
          <Show when={!disconnected()}>
            <header class="profile-header">
              <div>
                <p class="eyebrow">Kilo Account</p>
                <h1>Your Profile</h1>
                <p>Manage your Kilo identity, account context, credits, and billing shortcuts.</p>
              </div>
              <div class="profile-actions">
                <Button variant="secondary" type="button" onClick={refresh} disabled={data.loading || !server.query()}>
                  Refresh
                </Button>
                <a
                  class="profile-primary-link"
                  data-component="button"
                  data-size="default"
                  data-variant="primary"
                  href={cloud()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Dashboard
                </a>
              </div>
            </header>
          </Show>

          <Show when={!server.query() && server.discoverable()}>
            <LoadingScreen variant="fullscreen" />
          </Show>

          <Show when={data.loading && !data()}>
            <LoadingScreen variant="fullscreen" />
          </Show>

          <Show when={disconnected()}>
            <Card class="profile-connect-card">
              <span class="profile-connect-mark" aria-hidden="true">
                KG
              </span>
              <div class="profile-connect-copy">
                <p class="eyebrow">Kilo Account</p>
                <h1>Connect your Kilo account</h1>
                <p>Sign in to view your credits, organizations, and account details in Kilo Console.</p>
              </div>
              <A
                class="profile-primary-link"
                data-component="button"
                data-size="default"
                data-variant="primary"
                href={login()}
              >
                Connect
              </A>
            </Card>
          </Show>

          <Show when={!server.query() && !server.discoverable()}>
            <Card class="profile-banner" variant="warning">
              <strong>Kilo server not found</strong>
              <span>Start Kilo Console from a running Kilo server or pass a server URL with ?server=.</span>
            </Card>
          </Show>

          <Show when={data.error && !authError(data.error)}>
            <Card class="profile-banner" variant="error">
              <strong>Profile request failed</strong>
              <span>{errMsg(data.error)}</span>
            </Card>
          </Show>

          <Show when={error()}>
            <Card class="profile-banner" variant="error">
              <strong>Account update failed</strong>
              <span>{error()}</span>
            </Card>
          </Show>

          <Show when={profile()}>
            {(info) => (
              <div class="profile-grid">
                <Card class="profile-card profile-account-card">
                  <div class="profile-account-head">
                    <span class="profile-avatar" aria-hidden="true">
                      {initials(info().profile.name, info().profile.email)}
                    </span>
                    <div class="profile-account-text">
                      <strong>{info().profile.name || info().profile.email}</strong>
                      <span>{info().profile.email}</span>
                    </div>
                  </div>
                  <div class="profile-meta-row">
                    <span>Active account</span>
                    <strong>{account(info())}</strong>
                  </div>
                  <div class="profile-card-actions">
                    <Button variant="ghost" type="button" onClick={logout} disabled={Boolean(saving())}>
                      Log Out
                    </Button>
                  </div>
                </Card>

                <Card class="profile-card profile-balance-card">
                  <span class="profile-card-label">Remaining Credits</span>
                  <strong>{money(info().balance?.balance)}</strong>
                  <p>
                    Credits shown for {account(info())}. Switch accounts below to see organization balances when
                    available.
                  </p>
                </Card>

                <Card class="profile-card profile-wide-card">
                  <header class="profile-card-head">
                    <div>
                      <span class="profile-card-label">Organizations</span>
                      <h2>Your Accounts</h2>
                    </div>
                    <span class="profile-pill">{orgs().length === 1 ? "1 org" : `${orgs().length} orgs`}</span>
                  </header>
                  <div class="profile-org-list">
                    <button
                      type="button"
                      class="profile-org-row"
                      classList={{ active: !info().currentOrgId }}
                      onClick={() => choose(null)}
                      disabled={Boolean(saving())}
                    >
                      <span class="profile-org-icon" aria-hidden="true">
                        KG
                      </span>
                      <span class="profile-org-body">
                        <strong>Personal Account</strong>
                        <span>Your personal Kilo credits and settings</span>
                      </span>
                      <span class="profile-org-state">{!info().currentOrgId ? "Current" : "Use"}</span>
                    </button>
                    <For each={orgs()}>
                      {(item) => (
                        <button
                          type="button"
                          class="profile-org-row"
                          classList={{ active: active()?.id === item.id }}
                          onClick={() => choose(item.id)}
                          disabled={Boolean(saving())}
                        >
                          <span class="profile-org-icon" aria-hidden="true">
                            {initials(item.name, item.name)}
                          </span>
                          <span class="profile-org-body">
                            <strong>{item.name}</strong>
                            <span>{role(item)}</span>
                          </span>
                          <span class="profile-org-state">{active()?.id === item.id ? "Current" : "Use"}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Card>
              </div>
            )}
          </Show>
        </div>
      </section>
    </section>
  )
}
