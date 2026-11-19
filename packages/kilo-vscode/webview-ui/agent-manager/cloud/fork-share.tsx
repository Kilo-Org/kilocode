import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "../../src/context/language"
import { useBridge } from "../v2/vscode"
import { forkIntent } from "./fork-intent"
import type { ChatRoute, CloudNavigation } from "./route"

type Props = { api: OpenCodeClient; route: ChatRoute; nav: CloudNavigation; close: () => void; refresh: () => void }

function bind(props: Props) {
  const life = new AbortController()
  const route = props.route
  const active = () => !life.signal.aborted && props.nav.current() === route
  onCleanup(() => life.abort())
  createEffect(() => {
    if (!active()) {
      life.abort()
      props.close()
    }
  })
  return {
    active,
    rpc: props.api.rpc(KiloHostedRpc.Definition),
    options: { location: { directory: route.directory }, signal: life.signal },
    target: route.target,
  }
}

export function ForkDialog(props: Props) {
  const { t } = useLanguage()
  const client = bind(props)
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  async function fork() {
    if (busy() || !client.active()) return
    setBusy(true)
    setFailed(false)
    const intent = forkIntent(props.nav, props.route)
    try {
      const result = await client.rpc.forkSession(
        { target: client.target, operationKey: intent.operationKey },
        client.options,
      )
      if (!client.active()) return
      // Selecting the new session also closes this route-bound dialog.
      if (!intent.select(result.target)) {
        setFailed(true)
        return
      }
      props.refresh()
    } catch {
      if (client.active()) setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t("agentManager.tab.forkSession")} fit>
      <div class="am-project-dialog">
        <div class="am-project-dialog-content">
          <strong>{props.route.title}</strong>
          <div>{props.route.repository}</div>
          <Show when={failed()}>
            <div role="alert">{t("common.requestFailed")}</div>
          </Show>
        </div>
        <div class="am-project-dialog-footer">
          <Button onClick={props.close} variant="ghost">
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void fork()}>
            {busy() ? t("common.loading") : t("agentManager.tab.forkSession")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function SnapshotDialog(props: Props) {
  const { t } = useLanguage()
  const bridge = useBridge()
  const client = bind(props)
  const [state, setState] = createSignal<"checking" | "unavailable" | "ready" | "publishing" | "created" | "error">(
    "checking",
  )
  const [copied, setCopied] = createSignal(false)
  let confirmation: string | undefined
  let link: string | undefined
  onCleanup(() => {
    confirmation = undefined
    link = undefined
  })
  onMount(async () => {
    try {
      const result = await client.rpc.snapshotOptions({ target: client.target }, client.options)
      if (!client.active()) return
      if (!result.available) {
        setState("unavailable")
        return
      }
      confirmation = result.confirmation
      setState("ready")
    } catch {
      if (client.active()) setState("error")
    }
  })
  async function publish() {
    if (state() !== "ready" || !confirmation || !client.active()) return
    const input = { target: client.target, confirmation }
    confirmation = undefined
    setState("publishing")
    try {
      const result = await client.rpc.publishSnapshot(input, client.options)
      if (!client.active()) return
      link = result.url
      setState("created")
    } catch {
      if (client.active()) setState("error")
    }
  }
  function copy() {
    if (!client.active() || !link) return
    bridge.postMessage({ type: "agentManager.copyToClipboard", text: link })
    setCopied(true)
  }
  return (
    <Dialog title={t("agentManager.cloud.share.title")} fit>
      <div class="am-project-dialog">
        <div class="am-project-dialog-content">
          <strong>{props.route.title}</strong>
          <Show when={state() === "checking" || state() === "publishing"}>
            <div role="status">{t("common.loading")}</div>
          </Show>
          <Show when={state() === "ready" || state() === "created"}>
            <p>{t("agentManager.cloud.share.visibility")}</p>
            <p>
              {t("agentManager.cloud.share.snapshot")}{" "}
              {t("agentManager.cloud.share.expires", { duration: t("agentManager.cloud.share.sevenDays") })}
            </p>
          </Show>
          <Show when={state() === "ready"}>
            <p>{t("agentManager.cloud.share.replaces")}</p>
          </Show>
          <Show when={state() === "unavailable"}>
            <div role="status">{t("provider.anaconda.status.unavailable")}</div>
          </Show>
          <Show when={state() === "error"}>
            <div role="alert">{t("common.requestFailed")}</div>
          </Show>
        </div>
        <div class="am-project-dialog-footer">
          <Button variant="ghost" onClick={props.close}>
            {t(state() === "ready" ? "common.cancel" : "common.close")}
          </Button>
          <Show when={state() === "ready"}>
            <Button variant="primary" onClick={() => void publish()}>
              {t("agentManager.cloud.share.create")}
            </Button>
          </Show>
          <Show when={state() === "created"}>
            <Button variant="primary" onClick={copy}>
              {t(copied() ? "ui.textField.copied" : "ui.textField.copyLink")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
