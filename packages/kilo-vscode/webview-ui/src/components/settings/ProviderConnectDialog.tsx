// Main's provider connect dialog on v2 integrations. The v1 auth methods are the integration's methods: an API key
// is `api.integration.connect.key`, OAuth is `api.integration.oauth.*` (an automatic attempt is polled until it
// settles), and an external method is `api.integration.connect.external`. Method form fields replace the v1
// prompts. v1's client-side method fallbacks for Bedrock and Vertex and the Anaconda Desktop dialog are not here:
// the v2 server describes every method itself, and v2 has no Anaconda Desktop integration.
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import type { FormAnswer, FormField, IntegrationAttempt, IntegrationInfo } from "@opencode/client"
import { Component, For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "../../context/language"
import type { SettingsData } from "../../v2/settings"

interface ProviderConnectDialogProps {
  settings: SettingsData
  integrationID: string
  oauthOnly?: boolean
}

export type ConnectMethod = Extract<IntegrationInfo["methods"][number], { type: "key" | "oauth" | "external" }>

interface ViewState {
  methodIndex?: number
  authorization?: IntegrationAttempt
  phase?: "authorizing" | "connecting" | "prompts"
  error?: string
  field?: string
  failed?: string
}

type Prompt = Extract<FormField, { type: "string" }>

/**
 * The methods that the v1 dialog has a view for. Environment variables cannot be set from the dialog. v1 listed the
 * sign-in methods before the API key, while the v2 server lists the key first, so the key goes last.
 */
export function connectMethods(integration: IntegrationInfo | undefined): ConnectMethod[] {
  return (integration?.methods ?? [])
    .filter(
      (method): method is ConnectMethod =>
        method.type === "key" || method.type === "oauth" || method.type === "external",
    )
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

function formatError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (typeof value === "string" && value) return value
  return fallback
}

function prompts(method: ConnectMethod | undefined): Prompt[] {
  const fields: FormField[] = method?.form ?? []
  return fields.filter((field): field is Prompt => field.type === "string" && !field.hidden)
}

function visible(prompt: Prompt, values: Record<string, string>) {
  return (prompt.when ?? []).every((rule) => {
    const value = values[rule.key] ?? ""
    if (rule.op === "eq") return value === String(rule.value)
    return value !== String(rule.value)
  })
}

const ProviderConnectDialog: Component<ProviderConnectDialogProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const [state, setState] = createStore<ViewState>({})
  const attempt = { cancelled: false }

  const item = createMemo(() => props.settings.integration(props.integrationID))
  const name = () => item()?.name ?? props.integrationID
  const methods = createMemo<ConnectMethod[]>(() => {
    const list = connectMethods(item())
    if (props.oauthOnly) return list.filter((item) => item.type === "oauth")
    return list
  })
  const method = createMemo(() => {
    const index = state.methodIndex
    return index === undefined ? undefined : methods()[index]
  })

  function optional(prompt: Prompt) {
    return !prompt.required
  }

  function promptLabel(prompt: Prompt) {
    return prompt.title ?? prompt.key
  }

  function optionText(option: { label: string; value: string; description?: string }) {
    return option.description ? `${option.label} (${option.description})` : option.label
  }

  const PromptField: Component<{
    prompt: Prompt
    fields: Record<string, string>
    setField: (key: string, value: string) => void
    invalid?: boolean
    error?: string
  }> = (props) => {
    return (
      <Switch>
        <Match when={!props.prompt.options?.length}>
          <TextField
            type="text"
            autocomplete="off"
            spellcheck={false}
            label={promptLabel(props.prompt)}
            placeholder={props.prompt.placeholder}
            value={props.fields[props.prompt.key] ?? ""}
            onChange={(next) => props.setField(props.prompt.key, next)}
            validationState={props.invalid ? "invalid" : undefined}
            error={props.invalid ? props.error : undefined}
          />
        </Match>
        <Match when={props.prompt.options?.length}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label
              style={{
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                color: "var(--text-weak-base)",
              }}
            >
              {promptLabel(props.prompt)}
            </label>
            <Select
              options={props.prompt.options ?? []}
              current={props.prompt.options?.find((item) => item.value === props.fields[props.prompt.key])}
              value={(item) => item.value}
              label={(item) => optionText(item)}
              onSelect={(item) => props.setField(props.prompt.key, item?.value ?? "")}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
            <Show when={props.invalid && props.error}>
              <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}>
                {props.error}
              </span>
            </Show>
          </div>
        </Match>
      </Switch>
    )
  }

  const PromptFields: Component<{
    prompts: Prompt[]
    fields: Record<string, string>
    setField: (key: string, value: string) => void
    invalidKey?: string
    error?: string
  }> = (props) => (
    <>
      <For each={props.prompts}>
        {(prompt) => (
          <PromptField
            prompt={prompt}
            fields={props.fields}
            setField={props.setField}
            invalid={props.invalidKey === prompt.key}
            error={props.error}
          />
        )}
      </For>
      <Show when={props.error && !props.invalidKey}>
        <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-13)" }}>
          {props.error}
        </div>
      </Show>
    </>
  )

  /** Reads the visible prompts into an answer, or reports the first missing required field. */
  function answer(list: Prompt[], fields: Record<string, string>): FormAnswer | undefined | false {
    const inputs: Record<string, string> = {}
    for (const prompt of list) {
      const value = (fields[prompt.key] ?? "").trim()
      if (!value && !optional(prompt)) {
        setState({
          ...state,
          error: language.t("provider.connect.prompt.required", { field: promptLabel(prompt) }),
          field: prompt.key,
        })
        return false
      }
      if (!value) continue
      inputs[prompt.key] = value
    }
    return Object.keys(inputs).length > 0 ? inputs : undefined
  }

  const stop = () => {
    attempt.cancelled = true
    const current = state.authorization
    if (current) props.settings.cancel(props.integrationID, current.attemptID)
  }
  onCleanup(stop)

  onMount(() => {
    if (methods().length !== 1) return
    selectMethod(0)
  })

  function openExternal(url: string) {
    props.settings.open(url)
  }

  function reset() {
    stop()
    setState({
      methodIndex: undefined,
      authorization: undefined,
      phase: undefined,
      error: undefined,
      field: undefined,
      failed: undefined,
    })
  }

  function back() {
    if (methods().length === 1) {
      dialog.close()
      return
    }
    reset()
  }

  function fail(message: string) {
    const failed = state.authorization?.mode === "auto" || state.phase === "authorizing"
    setState({
      ...state,
      phase: undefined,
      error: failed ? undefined : message,
      field: undefined,
      failed: failed ? message : undefined,
    })
  }

  function succeed() {
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: name() }),
      description: language.t("provider.connect.toast.connected.description", { provider: name() }),
    })
    dialog.close()
  }

  function run(task: () => Promise<unknown>) {
    task().then(
      () => succeed(),
      (err: unknown) => fail(formatError(err, language.t("common.requestFailed"))),
    )
  }

  function authorize(inputs?: FormAnswer) {
    const current = method()
    if (!current || current.type === "key") return

    setState({
      ...state,
      phase: "authorizing",
      error: undefined,
      field: undefined,
      failed: undefined,
    })
    if (current.type === "external") {
      run(() => props.settings.connectExternal(props.integrationID, current.id, inputs))
      return
    }
    attempt.cancelled = false
    props.settings.authorize(props.integrationID, current.id, inputs).then(
      (authorization) => {
        if (attempt.cancelled) return props.settings.cancel(props.integrationID, authorization.attemptID)
        setState({
          ...state,
          authorization,
          phase: undefined,
          error: undefined,
          failed: undefined,
        })
      },
      (err: unknown) => fail(formatError(err, language.t("common.requestFailed"))),
    )
  }

  function selectMethod(index: number) {
    const current = methods()[index]
    stop()
    const needsPrompts = current?.type !== "key" && prompts(current).length > 0
    setState({
      methodIndex: index,
      authorization: undefined,
      phase: current?.type !== "key" ? (needsPrompts ? "prompts" : "authorizing") : undefined,
      error: undefined,
      field: undefined,
      failed: undefined,
    })
    if (current?.type === "key" || needsPrompts) return

    authorize()
  }

  function connect(apiKey: string, metadata?: FormAnswer) {
    setState({
      ...state,
      phase: "connecting",
      error: undefined,
      field: undefined,
      failed: undefined,
    })
    run(() => props.settings.connectKey(props.integrationID, apiKey, metadata))
  }

  function complete(code?: string) {
    const current = state.authorization
    if (!current) return

    setState({
      ...state,
      phase: "connecting",
      error: undefined,
      field: undefined,
      failed: undefined,
    })
    if (code === undefined) {
      run(() => props.settings.wait(props.integrationID, current.attemptID, attempt))
      return
    }
    run(() => props.settings.complete(props.integrationID, current.attemptID, code))
  }

  const title = () => language.t("provider.connect.title", { provider: name() })

  const MethodSelection: Component = () => {
    return (
      <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div class="provider-connect-body">{language.t("provider.connect.selectMethod", { provider: name() })}</div>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <For each={methods()}>
            {(item, index) => (
              <Button variant="secondary" size="large" onClick={() => selectMethod(index())}>
                {item.type === "key" ? item.label || language.t("provider.connect.method.apiKey") : item.label}
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
    const [fields, setFields] = createStore<Record<string, string>>({})
    const list = createMemo(() => prompts(method()).filter((prompt) => visible(prompt, fields)))

    function submit(e: SubmitEvent) {
      e.preventDefault()
      const apiKey = value().trim()
      if (!apiKey) {
        setState({ ...state, error: language.t("provider.connect.apiKey.required"), field: "apiKey" })
        return
      }
      const metadata = answer(list(), fields)
      if (metadata === false) return
      connect(apiKey, metadata)
    }

    return (
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        <div class="provider-connect-body">
          {language.t("provider.connect.apiKey.description", { provider: name() })}
        </div>
        <TextField
          autofocus
          type="password"
          autocomplete="off"
          spellcheck={false}
          label={language.t("provider.connect.apiKey.label", { provider: name() })}
          placeholder={language.t("provider.connect.apiKey.placeholder")}
          value={value()}
          onChange={setValue}
          validationState={state.field === "apiKey" ? "invalid" : undefined}
          error={state.field === "apiKey" ? state.error : undefined}
        />
        <PromptFields
          prompts={list()}
          fields={fields}
          setField={(key, value) => setFields(key, value)}
          invalidKey={state.field}
          error={state.error}
        />
        <div class="dialog-confirm-actions provider-connect-actions">
          <div class="provider-connect-byok">
            {language.t("provider.connect.kiloGateway.byok.prefix")}
            <a
              href="https://blog.kilo.ai/p/kilo-gateway-now-supports-byok-20-providers"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                openExternal("https://blog.kilo.ai/p/kilo-gateway-now-supports-byok-20-providers")
              }}
              class="provider-connect-byok-link"
            >
              {language.t("provider.connect.kiloGateway.byok.link")}
            </a>
            {language.t("provider.connect.kiloGateway.byok.suffix")}
          </div>
          <Button variant="ghost" size="large" type="button" onClick={back}>
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
        <div class="provider-connect-body">
          {language.t("provider.connect.oauth.code.visit.prefix")}
          <a
            href={state.authorization?.url ?? "#"}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
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
          <Button variant="ghost" size="large" type="button" onClick={back}>
            {language.t("common.goBack")}
          </Button>
          <Button variant="primary" size="large" type="submit" disabled={state.phase === "connecting"}>
            {language.t("common.submit")}
          </Button>
        </div>
      </form>
    )
  }

  const OAuthPromptsView: Component = () => {
    const [fields, setFields] = createStore<Record<string, string>>({})
    const list = createMemo(() => prompts(method()).filter((prompt) => visible(prompt, fields)))

    function submit(e: SubmitEvent) {
      e.preventDefault()
      const inputs = answer(list(), fields)
      if (inputs === false) return
      authorize(inputs)
    }

    return (
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        <PromptFields
          prompts={list()}
          fields={fields}
          setField={(key, value) => setFields(key, value)}
          invalidKey={state.field}
          error={state.error}
        />
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" type="button" onClick={back}>
            {language.t("common.goBack")}
          </Button>
          <Button variant="primary" size="large" type="submit">
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
        <div class="provider-connect-body">
          {language.t("provider.connect.oauth.auto.visit.prefix")}
          <a
            href={state.authorization?.url ?? "#"}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
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
            <div class="provider-connect-code-label">{language.t("provider.connect.oauth.auto.confirmationCode")}</div>
            <div class="provider-connect-code">{code()}</div>
          </div>
        </Show>
        <div class="provider-connect-status">
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
        <Match when={state.phase === "prompts"}>
          <OAuthPromptsView />
        </Match>
        <Match when={state.phase === "authorizing"}>
          <div class="dialog-confirm-body">
            <div class="provider-connect-status">
              <Spinner />
              <span>{language.t("provider.connect.status.inProgress")}</span>
            </div>
          </div>
        </Match>
        <Match when={state.failed}>
          <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <div>{formatError(state.failed, language.t("common.requestFailed"))}</div>
            <div class="dialog-confirm-actions">
              <Button variant="ghost" size="large" onClick={back}>
                {language.t("common.goBack")}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={method()?.type === "key"}>
          <ApiView />
        </Match>
        <Match when={state.authorization?.mode === "code"}>
          <OAuthCodeView />
        </Match>
        <Match when={state.authorization?.mode === "auto"}>
          <OAuthAutoView />
        </Match>
        <Match when={true}>
          <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <div>{formatError(state.error ?? state.failed, language.t("common.requestFailed"))}</div>
            <div class="dialog-confirm-actions">
              <Button variant="ghost" size="large" onClick={back}>
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
