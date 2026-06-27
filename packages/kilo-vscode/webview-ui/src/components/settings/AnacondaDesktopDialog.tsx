import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tag } from "@kilocode/kilo-ui/tag"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2/client"
import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import { createAnacondaDesktopAction } from "../../utils/anaconda-desktop-action"

interface AnacondaDesktopDialogProps {
  status?: AnacondaDesktopStatus
  connected?: boolean
}

const ID = "anaconda-desktop"

function AnacondaDesktopDialog(props: AnacondaDesktopDialogProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const provider = useProvider()
  const vscode = useVSCode()
  const action = createAnacondaDesktopAction(vscode)
  const [status, setStatus] = createSignal<AnacondaDesktopStatus | undefined>(props.status)
  const [checking, setChecking] = createSignal(false)
  const [opening, setOpening] = createSignal(false)
  const [syncing, setSyncing] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const managing = props.connected ?? provider.connected().includes(ID)

  function check() {
    if (checking() || opening() || syncing()) return
    setChecking(true)
    setError()
    action.send(
      { type: "anacondaDesktopStatus" },
      {
        onStatus: (message) => {
          setChecking(false)
          setStatus(message.status)
        },
        onError: (message) => {
          setChecking(false)
          setError(message.message)
        },
      },
    )
  }

  onMount(() => {
    if (!props.status) check()
  })
  onCleanup(action.dispose)

  function open() {
    if (opening() || checking() || syncing()) return
    setOpening(true)
    setError()
    action.send(
      { type: "anacondaDesktopOpen" },
      {
        onOpened: () => setOpening(false),
        onError: (message) => {
          setOpening(false)
          setError(message.message)
        },
      },
    )
  }

  function download(url: string) {
    vscode.postMessage({ type: "openExternal", url })
  }

  function sync(acknowledge: boolean) {
    if (syncing() || checking() || opening()) return
    setSyncing(true)
    setError()
    action.send(
      { type: "anacondaDesktopSync", acknowledgeToolLimitations: acknowledge },
      {
        onSynced: () => {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t(
              managing ? "provider.anaconda.toast.refreshed.title" : "provider.connect.toast.connected.title",
              { provider: "Anaconda Desktop" },
            ),
            description: language.t(
              managing
                ? "provider.anaconda.toast.refreshed.description"
                : "provider.connect.toast.connected.description",
              { provider: "Anaconda Desktop" },
            ),
          })
          dialog.close()
        },
        onError: (message) => {
          setSyncing(false)
          setError(message.message)
        },
      },
    )
  }

  function description(current: AnacondaDesktopStatus) {
    if (current.type === "unsupported-platform") {
      return language.t("provider.anaconda.state.unsupported", { platform: current.platform })
    }
    if (current.type === "not-installed") return language.t("provider.anaconda.state.notInstalled")
    if (current.type === "not-running") return language.t("provider.anaconda.state.notRunning")
    if (current.type === "invalid-config") return language.t("provider.anaconda.state.invalidConfig")
    if (current.type === "signed-out") return language.t("provider.anaconda.state.signedOut")
    if (current.type === "management-unauthorized") return language.t("provider.anaconda.state.unauthorized")
    if (current.type === "management-unavailable") return language.t("provider.anaconda.state.unavailable")
    if (current.type === "no-downloaded-model") return language.t("provider.anaconda.state.noModel")
    if (current.type === "no-running-server") {
      const key =
        current.downloadedModels === 1
          ? "provider.anaconda.state.noServer_one"
          : "provider.anaconda.state.noServer_other"
      return language.t(key, { count: current.downloadedModels })
    }
    if (current.type === "inference-unhealthy") return language.t("provider.anaconda.state.unhealthy")
    return language.t("provider.anaconda.state.ready")
  }

  function label(current: AnacondaDesktopStatus) {
    if (current.type === "ready") return language.t("provider.anaconda.status.ready")
    if (current.type === "unsupported-platform" || current.type === "not-installed") {
      return language.t("provider.anaconda.status.unavailable")
    }
    if (
      current.type === "not-running" ||
      current.type === "no-downloaded-model" ||
      current.type === "no-running-server"
    ) {
      return language.t("provider.anaconda.status.waiting")
    }
    return language.t("provider.anaconda.status.attention")
  }

  function tools(value: Extract<AnacondaDesktopStatus, { type: "ready" }>["toolcall"]) {
    if (value === "supported") return language.t("provider.anaconda.tools.supported")
    if (value === "unsupported") return language.t("provider.anaconda.tools.unsupported")
    return language.t("provider.anaconda.tools.unknown")
  }

  const ready = createMemo(() => {
    const current = status()
    return current?.type === "ready" ? current : undefined
  })
  const canOpen = createMemo(() => {
    const current = status()
    if (!current) return false
    return (
      current.type === "not-running" ||
      current.type === "invalid-config" ||
      current.type === "signed-out" ||
      current.type === "management-unauthorized" ||
      current.type === "management-unavailable" ||
      current.type === "no-downloaded-model" ||
      current.type === "no-running-server" ||
      current.type === "inference-unhealthy"
    )
  })

  return (
    <Dialog title={language.t(managing ? "provider.anaconda.title.manage" : "provider.anaconda.title.connect")} fit>
      <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
        <Switch>
          <Match when={status()}>
            {(current) => (
              <Card variant={current().type === "ready" ? "success" : "info"}>
                <CardTitle variant={current().type === "ready" ? "success" : "info"}>{label(current())}</CardTitle>
                <CardDescription>{description(current())}</CardDescription>
              </Card>
            )}
          </Match>
          <Match when={checking()}>
            <div class="provider-connect-status">
              <Spinner />
              <span>{language.t("provider.anaconda.status.checking")}</span>
            </div>
          </Match>
        </Switch>

        <Show when={ready()}>
          {(current) => (
            <>
              <Card>
                <CardTitle icon="server">{current().serverName ?? language.t("provider.anaconda.server")}</CardTitle>
                <CardDescription>
                  <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
                    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
                      <For each={current().models}>{(model) => <Tag size="large">{model.name}</Tag>}</For>
                    </div>
                    <div style={{ display: "flex", "justify-content": "space-between", gap: "12px" }}>
                      <span>{language.t("provider.anaconda.context")}</span>
                      <strong>{language.t("provider.anaconda.contextValue", { count: current().context })}</strong>
                    </div>
                    <div style={{ display: "flex", "justify-content": "space-between", gap: "12px" }}>
                      <span>{language.t("provider.anaconda.tools")}</span>
                      <strong>{tools(current().toolcall)}</strong>
                    </div>
                  </div>
                </CardDescription>
              </Card>
              <Show when={current().toolcall !== "supported"}>
                <Card variant="warning">
                  <CardTitle variant="warning">{language.t("provider.anaconda.warning.title")}</CardTitle>
                  <CardDescription>{language.t("provider.anaconda.warning.description")}</CardDescription>
                </Card>
              </Show>
            </>
          )}
        </Show>

        <Show when={error()}>
          {(message) => (
            <Card variant="error">
              <CardTitle variant="error">{language.t("common.requestFailed")}</CardTitle>
              <CardDescription>{message()}</CardDescription>
            </Card>
          )}
        </Show>

        <Show when={(!!status() && checking()) || opening() || syncing()}>
          <div class="provider-connect-status">
            <Spinner />
            <span>
              {language.t(
                checking()
                  ? "provider.anaconda.status.checking"
                  : syncing()
                    ? "provider.anaconda.status.syncing"
                    : "provider.anaconda.status.opening",
              )}
            </span>
          </div>
        </Show>

        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" onClick={() => dialog.close()} disabled={syncing()}>
            {language.t("common.cancel")}
          </Button>
          <Show when={status()?.type === "not-installed"}>
            <Button
              variant="primary"
              size="large"
              icon="link"
              onClick={() => {
                const current = status()
                if (current?.type === "not-installed") download(current.downloadURL)
              }}
            >
              {language.t("provider.anaconda.action.download")}
            </Button>
          </Show>
          <Show when={canOpen()}>
            <Button variant="secondary" size="large" onClick={open} disabled={checking() || opening() || syncing()}>
              {language.t("provider.anaconda.action.open")}
            </Button>
          </Show>
          <Show when={!checking()}>
            <Button variant="secondary" size="large" onClick={check} disabled={opening() || syncing()}>
              {language.t("provider.anaconda.action.checkAgain")}
            </Button>
          </Show>
          <Show when={ready()?.toolcall === "supported"}>
            <Button
              variant="primary"
              size="large"
              onClick={() => sync(false)}
              disabled={checking() || opening() || syncing()}
            >
              {language.t(managing ? "common.refresh" : "common.connect")}
            </Button>
          </Show>
          <Show when={ready()?.toolcall !== "supported" && !!ready()}>
            <Button
              variant="primary"
              size="large"
              onClick={() => sync(true)}
              disabled={checking() || opening() || syncing()}
            >
              {language.t("provider.anaconda.action.continue")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

export default AnacondaDesktopDialog
