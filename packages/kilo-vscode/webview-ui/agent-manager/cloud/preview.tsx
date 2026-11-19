import type { OpenCodeClient } from "@opencode/client"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "../../src/context/language"
import { useBridge } from "../v2/vscode"
import type { ChatRoute } from "./route"

export function CloudPreviewDialog(props: { api: OpenCodeClient; route: ChatRoute; close: () => void }) {
  const { t } = useLanguage()
  const bridge = useBridge()
  const life = new AbortController()
  const rpc = props.api.rpc(KiloHostedRpc.Definition)
  const opts = { location: { directory: props.route.directory }, signal: life.signal }
  const target = props.route.target
  const [port, setPort] = createSignal("3000")
  const [state, setState] = createSignal<"loading" | "ready" | "unavailable" | "failure">("loading")
  const [opening, setOpening] = createSignal(false)
  onCleanup(() => life.abort())
  async function check() {
    setState("loading")
    try {
      const result = await rpc.previewOptions({ target }, opts)
      if (!life.signal.aborted) setState(result.enabled ? "ready" : "unavailable")
    } catch {
      if (!life.signal.aborted) setState("failure")
    }
  }
  onMount(() => void check())
  const valid = () => /^\d+$/.test(port()) && Number(port()) >= 1024 && Number(port()) <= 65535
  async function open() {
    if (state() !== "ready" || opening() || !valid()) return
    setOpening(true)
    try {
      const result = await rpc.openPreview({ target, port: Number(port()) }, opts)
      if (life.signal.aborted) return
      bridge.postMessage({ type: "agentManager.openExternal", url: result.url })
      props.close()
    } catch {
      if (!life.signal.aborted) setState("failure")
    } finally {
      setOpening(false)
    }
  }
  return (
    <Dialog title={t("agentManager.pr.comment.preview")} fit>
      <form
        class="am-project-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          void open()
        }}
      >
        <div class="am-project-dialog-content">
          <label class="am-project-dialog-field">
            <span>{t("settings.aboutKiloCode.port.label")} (1024–65535)</span>
            <input
              autofocus
              class="am-nv-name-input"
              type="number"
              min={1024}
              max={65535}
              step={1}
              required
              value={port()}
              onInput={(e) => setPort(e.currentTarget.value)}
            />
          </label>
          <Show when={state() === "loading"}>
            <div role="status">{t("agentManager.import.loading")}</div>
          </Show>
          <Show when={state() === "unavailable"}>
            <div role="status">{t("provider.anaconda.status.unavailable")}</div>
          </Show>
          <Show when={state() === "failure"}>
            <div role="alert">
              {t("common.requestFailed")}{" "}
              <Button type="button" onClick={() => void check()}>
                {t("common.retry")}
              </Button>
            </div>
          </Show>
        </div>
        <div class="am-project-dialog-footer">
          <Button type="button" variant="ghost" onClick={props.close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={opening() || state() !== "ready" || !valid()}>
            {t("agentManager.browser.openExternal")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
