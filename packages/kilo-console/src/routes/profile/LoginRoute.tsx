import { useLocation, useNavigate } from "@solidjs/router"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { LoadingScreen } from "../../components/LoadingScreen"
import { completeKiloLogin, loadKiloProfile, startKiloLogin, type ProjectQuery } from "../../client"
import { errMsg } from "../../shared/utils"
import { markDisconnected, page, parseDeviceCode, safeReturn } from "./profile-utils"
import { useProfileServer } from "./server"

type Status = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

type State = {
  status: Status
  code?: string
  url?: string
  expiresIn?: number
  error?: string
}

function time(input: number) {
  const min = Math.floor(input / 60)
  const sec = input % 60
  return `${min}:${sec.toString().padStart(2, "0")}`
}

export function LoginRoute() {
  const loc = useLocation()
  const nav = useNavigate()
  const params = createMemo(() => new URLSearchParams(loc.search))
  const server = useProfileServer(params)
  const [auth, setAuth] = createSignal<State>({ status: "idle" })
  const [left, setLeft] = createSignal(900)
  const [attempt, setAttempt] = createSignal(0)
  const [active, setActive] = createSignal<AbortController>()
  const [copied, setCopied] = createSignal("")
  const ret = () => safeReturn(params().get("return"))
  const profile = () => page(params(), "/profile")

  function abort() {
    active()?.abort()
    setActive(undefined)
  }

  function done() {
    window.setTimeout(() => nav(ret(), { replace: true }), 650)
  }

  function start(input: ProjectQuery | undefined = server.query()) {
    if (!input) return
    abort()
    const ctl = new AbortController()
    const rev = attempt() + 1
    setAttempt(rev)
    setActive(ctl)
    setAuth({ status: "initiating" })
    void startKiloLogin(input)
      .then((info) => {
        if (attempt() !== rev) return false
        setAuth({
          status: "pending",
          code: parseDeviceCode(info.instructions),
          url: info.url,
          expiresIn: 900,
        })
        return completeKiloLogin(input, ctl.signal).then(() => true)
      })
      .then((ok) => {
        if (!ok || attempt() !== rev) return
        setAuth({ status: "success" })
        void loadKiloProfile(input)
          .then(() => markDisconnected(false))
          .catch(() => markDisconnected(false))
          .finally(done)
      })
      .catch((err) => {
        if (attempt() !== rev) return
        setAuth({ status: "error", error: errMsg(err) })
      })
      .finally(() => {
        if (active() === ctl) setActive(undefined)
      })
  }

  function cancel() {
    abort()
    setAttempt((value) => value + 1)
    setAuth({ status: "cancelled" })
  }

  function copy(label: string, value: string | undefined) {
    if (!value) return
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(label)
        window.setTimeout(() => {
          if (copied() === label) setCopied("")
        }, 1400)
      })
      .catch((err) => setAuth({ status: "error", error: errMsg(err) }))
  }

  function open() {
    const url = auth().url
    if (!url) return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  createEffect(() => {
    const current = server.query()
    if (!current || auth().status !== "idle") return
    start(current)
  })

  createEffect(() => {
    const state = auth()
    if (state.status !== "pending") return
    setLeft(state.expiresIn ?? 900)
    const timer = window.setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    if (auth().status === "success") server.remember()
  })

  onCleanup(() => {
    abort()
    setAttempt((value) => value + 1)
  })

  return (
    <section class="route-empty">
      <div class="profile-login-page">
        <header class="profile-login-header">
          <p class="eyebrow">Kilo Login</p>
          <h1>Login to Kilo</h1>
          <p>Authorize this Kilo Console through the same device auth flow used by the editor clients.</p>
        </header>

        <Show when={!server.query() && server.discoverable()}>
          <LoadingScreen variant="fullscreen" />
        </Show>

        <Show when={!server.query() && !server.discoverable()}>
          <Card class="profile-login-card" variant="warning">
            <strong>Kilo server not found</strong>
            <p>Start a local Kilo server or pass a server URL with ?server=.</p>
            <a class="profile-link-button" href={profile()}>
              Back to Profile
            </a>
          </Card>
        </Show>

        <Show when={server.query()}>
          <Card class="profile-login-card">
            <Switch>
              <Match when={auth().status === "idle" || auth().status === "initiating"}>
                <div class="profile-login-state">
                  <span class="profile-spinner" aria-hidden="true" />
                  <strong>Starting login...</strong>
                  <p>Preparing a secure browser authorization request.</p>
                </div>
              </Match>

              <Match when={auth().status === "pending"}>
                <div class="profile-login-flow">
                  <div class="profile-login-step">
                    <span>Step 1</span>
                    <strong>Open this URL</strong>
                    <div class="profile-login-url">
                      <span>{auth().url}</span>
                      <Button variant="secondary" type="button" onClick={() => copy("url", auth().url)}>
                        {copied() === "url" ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <Button variant="primary" type="button" onClick={open}>
                      Open Browser
                    </Button>
                  </div>

                  <Show when={auth().code}>
                    {(code) => (
                      <div class="profile-login-step">
                        <span>Step 2</span>
                        <strong>Enter this code</strong>
                        <button type="button" class="profile-login-code" onClick={() => copy("code", code())}>
                          {code()}
                          <small>{copied() === "code" ? "Copied" : "Click to copy"}</small>
                        </button>
                      </div>
                    )}
                  </Show>

                  <div class="profile-login-waiting">
                    <span class="profile-spinner" aria-hidden="true" />
                    <span>Waiting for authorization ({time(left())})</span>
                  </div>

                  <Button variant="ghost" type="button" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              </Match>

              <Match when={auth().status === "success"}>
                <div class="profile-login-state success">
                  <strong>Login successful</strong>
                  <p>Redirecting back to your profile.</p>
                </div>
              </Match>

              <Match when={auth().status === "error"}>
                <div class="profile-login-state error">
                  <strong>Login failed</strong>
                  <p>{auth().error}</p>
                  <div class="profile-login-actions">
                    <Button variant="primary" type="button" onClick={() => start()}>
                      Try Again
                    </Button>
                    <a class="profile-link-button" href={profile()}>
                      Back to Profile
                    </a>
                  </div>
                </div>
              </Match>

              <Match when={auth().status === "cancelled"}>
                <div class="profile-login-state">
                  <strong>Login cancelled</strong>
                  <p>No credentials were saved.</p>
                  <Button variant="primary" type="button" onClick={() => start()}>
                    Start Again
                  </Button>
                </div>
              </Match>
            </Switch>
          </Card>
        </Show>
      </div>
    </section>
  )
}
