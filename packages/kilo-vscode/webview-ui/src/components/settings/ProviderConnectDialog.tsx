import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import { Component, For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

interface ProviderConnectDialogProps {
  providerID: string
}

interface ViewState {
  methodIndex?: number
  authorization?: ProviderAuthAuthorization
  phase?: "authorizing" | "connecting"
  error?: string
  failed?: string
}

function fallbackMethods(label: string): ProviderAuthMethod[] {
  return [{ type: "api", label }]
}

function formatError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (typeof value === "string" && value) return value
  return fallback
}

export const ProviderConnectDialog: Component<ProviderConnectDialogProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const provider = useProvider()
  const vscode = useVSCode()

  const [requestId, setRequestId] = createSignal<string>()
  const [state, setState] = createStore<ViewState>({})

  const item = createMemo(() => provider.providers()[props.providerID])
  const name = () => item()?.name ?? props.providerID
  const methods = createMemo<ProviderAuthMethod[]>(() => {
    return provider.authMethods()[props.providerID] ?? fallbackMethods(language.t("provider.connect.method.apiKey"))
  })
  const method = createMemo(() => {
    const index = state.methodIndex
    return index === undefined ? undefined : methods()[index]
  })

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (!("requestId" in message) || message.requestId !== requestId()) return

    if (message.type === "providerOAuthReady") {
      setState({
        ...state,
        authorization: message.authorization,
        phase: undefined,
        error: undefined,
        failed: undefined,
      })
      return
    }

    if (message.type === "providerConnected") {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: name() }),
        description: language.t("provider.connect.toast.connected.description", { provider: name() }),
      })
      dialog.close()
      return
    }

    if (message.type === "providerActionError") {
      const failed = state.authorization?.method === "auto" || state.phase === "authorizing"
      setState({
        ...state,
        phase: undefined,
        error: failed ? undefined : message.message,
        failed: failed ? message.message : undefined,
      })
    }
  })

  onCleanup(unsubscribe)

  onMount(() => {
    if (methods().length !== 1) return
    selectMethod(0)
  })

  function openExternal(url: string) {
    vscode.postMessage({ type: "openExternal", url })
  }

  function reset() {
    setRequestId(undefined)
    setState({
      methodIndex: undefined,
      authorization: undefined,
      phase: undefined,
      error: undefined,
      failed: undefined,
    })
  }

  function selectMethod(index: number) {
    const current = methods()[index]
    setRequestId(undefined)
    setState({
      methodIndex: index,
      authorization: undefined,
      phase: current?.type === "oauth" ? "authorizing" : undefined,
      error: undefined,
      failed: undefined,
    })
    if (current?.type !== "oauth") return

    const next = crypto.randomUUID()
    setRequestId(next)
    vscode.postMessage({
      type: "authorizeProviderOAuth",
      requestId: next,
      providerID: props.providerID,
      method: index,
    })
  }

  function connect(apiKey: string) {
    const next = crypto.randomUUID()
    setRequestId(next)
    setState({
      ...state,
      phase: "connecting",
      error: undefined,
      failed: undefined,
    })
    vscode.postMessage({
      type: "connectProvider",
      requestId: next,
      providerID: props.providerID,
      apiKey,
    })
  }

  function complete(code?: string) {
    const index = state.methodIndex
    if (index === undefined) return

    const next = crypto.randomUUID()
    setRequestId(next)
    setState({
      ...state,
      phase: "connecting",
      error: undefined,
      failed: undefined,
    })
    vscode.postMessage({
      type: "completeProviderOAuth",
      requestId: next,
      providerID: props.providerID,
      method: index,
      code,
    })
  }

  const title = () => language.t("provider.connect.title", { provider: name() })

  const MethodSelection: Component = () => {
    return (
      <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div style={{ "font-size": "13px", color: "var(--text-base)" }}>
          {language.t("provider.connect.selectMethod", { provider: name() })}
        </div>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <For each={methods()}>
            {(item, index) => (
              <Button variant="secondary" size="large" onClick={() => selectMethod(index())}>
                {item.type === "api" ? language.t("provider.connect.method.apiKey") : item.label}
              </Button>
            )}
          </For>
        </div>
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </div>
    )
  }

  const ApiView: Component = () => {
    const [value, setValue] = createSignal("")

    function submit(e: SubmitEvent) {
      e.preventDefault()
      const apiKey = value().trim()
      if (!apiKey) {
        setState({ ...state, error: language.t("provider.connect.apiKey.required") })
        return
      }
      connect(apiKey)
    }

    return (
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        <div style={{ "font-size": "13px", color: "var(--text-base)" }}>
          {language.t("provider.connect.apiKey.description", { provider: name() })}
        </div>
        <TextField
          autofocus
          type="text"
          label={language.t("provider.connect.apiKey.label", { provider: name() })}
          placeholder={language.t("provider.connect.apiKey.placeholder")}
          value={value()}
          onChange={setValue}
          validationState={state.error ? "invalid" : undefined}
          error={state.error}
        />
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" type="button" onClick={reset}>
            {language.t("common.goBack")}
          </Button>
          <Button variant="primary" size="large" type="submit" disabled={state.phase === "connecting"}>
            {language.t("common.submit")}
          </Button>
        </div>
      </form>
    )
  }

  const OAuthCodeView: Component = () => {
    const [value, setValue] = createSignal("")

    onMount(() => {
      if (!state.authorization?.url) return
      openExternal(state.authorization.url)
    })

    function submit(e: SubmitEvent) {
      e.preventDefault()
      const code = value().trim()
      if (!code) {
        setState({ ...state, error: language.t("provider.connect.oauth.code.required") })
        return
      }
      complete(code)
    }

    return (
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        <div style={{ "font-size": "13px", color: "var(--text-base)" }}>
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <a
            href={state.authorization?.url ?? "#"}
            onClick={(e) => {
              e.preventDefault()
              if (!state.authorization?.url) return
              openExternal(state.authorization.url)
            }}
          >
            {language.t("provider.connect.oauth.code.visit.link")}
          </a>
          {language.t("provider.connect.oauth.code.visit.suffix", { provider: name() })}
        </div>
        <TextField
          autofocus
          type="text"
          label={language.t("provider.connect.oauth.code.label", { method: method()?.label ?? "" })}
          placeholder={language.t("provider.connect.oauth.code.placeholder")}
          value={value()}
          onChange={setValue}
          validationState={state.error ? "invalid" : undefined}
          error={state.error}
        />
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" type="button" onClick={reset}>
            {language.t("common.goBack")}
          </Button>
          <Button variant="primary" size="large" type="submit" disabled={state.phase === "connecting"}>
            {language.t("common.submit")}
          </Button>
        </div>
      </form>
    )
  }

  const OAuthAutoView: Component = () => {
    const code = createMemo(() => {
      const instructions = state.authorization?.instructions
      if (!instructions) return ""
      if (!instructions.includes(":")) return instructions
      return instructions.split(":")[1]?.trim() ?? instructions
    })

    onMount(() => {
      if (state.authorization?.url) openExternal(state.authorization.url)
      complete()
    })

    return (
      <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
        <div style={{ "font-size": "13px", color: "var(--text-base)" }}>
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <a
            href={state.authorization?.url ?? "#"}
            onClick={(e) => {
              e.preventDefault()
              if (!state.authorization?.url) return
              openExternal(state.authorization.url)
            }}
          >
            {language.t("provider.connect.oauth.auto.visit.link")}
          </a>
          {language.t("provider.connect.oauth.auto.visit.suffix", { provider: name() })}
        </div>
        <Show when={code()}>
          <div>
            <div style={{ "font-size": "12px", color: "var(--text-weak-base)" }}>
              {language.t("provider.connect.oauth.auto.confirmationCode")}
            </div>
            <div
              style={{
                "font-family": "monospace",
                padding: "8px 10px",
                border: "1px solid var(--border-weak-base)",
                "border-radius": "8px",
                "margin-top": "6px",
              }}
            >
              {code()}
            </div>
          </div>
        </Show>
        <div style={{ display: "flex", gap: "8px", "align-items": "center", "font-size": "13px" }}>
          <Spinner />
          <span>
            {state.error
              ? language.t("provider.connect.status.failed", { error: state.error })
              : language.t("provider.connect.status.waiting")}
          </span>
        </div>
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" type="button" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Dialog title={title()} fit>
      <Switch>
        <Match when={state.methodIndex === undefined}>
          <MethodSelection />
        </Match>
        <Match when={state.phase === "authorizing"}>
          <div class="dialog-confirm-body">
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <Spinner />
              <span>{language.t("provider.connect.status.inProgress")}</span>
            </div>
          </div>
        </Match>
        <Match when={state.failed}>
          <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <div>{formatError(state.failed, language.t("common.requestFailed"))}</div>
            <div class="dialog-confirm-actions">
              <Button variant="ghost" size="large" onClick={reset}>
                {language.t("common.goBack")}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={method()?.type === "api"}>
          <ApiView />
        </Match>
        <Match when={state.authorization?.method === "code"}>
          <OAuthCodeView />
        </Match>
        <Match when={state.authorization?.method === "auto"}>
          <OAuthAutoView />
        </Match>
        <Match when={true}>
          <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <div>{formatError(state.error ?? state.failed, language.t("common.requestFailed"))}</div>
            <div class="dialog-confirm-actions">
              <Button variant="ghost" size="large" onClick={reset}>
                {language.t("common.goBack")}
              </Button>
            </div>
          </div>
        </Match>
      </Switch>
    </Dialog>
  )
}

export default ProviderConnectDialog
