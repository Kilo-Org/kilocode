// Main's provider connect dialog on v2 integrations. The v1 auth methods are the integration's methods: an API key
// is `api.integration.connect.key`, OAuth is `api.integration.oauth.*` (an automatic attempt is polled until it
// settles), and an external method is `api.integration.connect.external`. Method form fields replace the v1
// prompts and are validated with `v2/form.ts` (`formAnswer`), the same answer shape the question dock sends.
// v1's client-side method fallbacks for Bedrock and Vertex and the Anaconda Desktop dialog are not here: the v2
// server describes every method itself, and v2 has no Anaconda Desktop integration.
import { Button } from "@kilocode/kilo-ui/button"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import type {
  FormAnswer,
  FormField,
  FormOption,
  FormValue,
  IntegrationAttempt,
  IntegrationInfo,
} from "@opencode/client"
import { Component, For, Match, Show, Switch, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "../../context/language"
import { type Draft, formAnswer } from "../../v2/form"
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

export function methodFields(method: ConnectMethod | undefined): FormField[] {
  return method?.form ?? []
}

function formatError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (typeof value === "string" && value) return value
  return fallback
}

const ProviderConnectDialog: Component<ProviderConnectDialogProps> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()

  const [state, setState] = createStore<ViewState>({})
  const attempt = { cancelled: false }

  const item = createMemo(() => props.settings.integration(props.integrationID))
  const name = () => item()?.name ?? props.integrationID
  const heading = () => language.t("provider.connect.title", { provider: name() })
  const methods = createMemo<ConnectMethod[]>(() => {
    const list = connectMethods(item())
    if (props.oauthOnly) return list.filter((item) => item.type === "oauth")
    return list
  })
  const method = createMemo(() => {
    const index = state.methodIndex
    return index === undefined ? undefined : methods()[index]
  })

  function label(field: FormField) {
    return field.title ?? field.key
  }

  function optionText(option: { label: string; value: string; description?: string }) {
    return option.description ? `${option.label} (${option.description})` : option.label
  }

  function openExternal(url: string) {
    props.settings.open(url)
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

  /** `false` means the work stopped without a result (a cancelled OAuth attempt), so nothing was connected. */
  function run(task: () => Promise<unknown>) {
    task().then(
      (result) => {
        if (result === false) return
        succeed()
      },
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
    const needsPrompts = current?.type !== "key" && methodFields(current).length > 0
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

  /**
   * The method's form fields, as `Form.Fields` describes them. A `custom` text field takes a value outside the
   * discovered options, and `formAnswer` seeds defaults, resolves `when` on the answers and types the values.
   */
  const MethodForm: Component<{
    fields: FormField[]
    busy?: boolean
    leading?: JSX.Element
    footer?: JSX.Element
    beforeSubmit?: () => boolean
    onSubmit: (answer: FormAnswer | undefined) => void
  }> = (form) => {
    const [values, setValues] = createSignal<Draft>({})
    const [custom, setCustom] = createStore<Record<string, string>>({})
    const [error, setError] = createSignal<string>()

    const result = createMemo(() => formAnswer(form.fields, values(), custom))
    const visible = () => result().visible

    const value = (field: FormField) => {
      const current = values()[field.key]
      if (current !== undefined) return current
      if (field.type === "boolean") return field.default ?? false
      if (field.type === "external") return undefined
      return field.default
    }

    const set = (field: FormField, next: FormValue | undefined) => {
      setError(undefined)
      setValues({ ...values(), [field.key]: next })
    }

    const invalid = (field: FormField) => {
      const message = error()
      return !!message && message.startsWith(field.title ?? field.key)
    }

    function submit(e: SubmitEvent) {
      e.preventDefault()
      if (form.beforeSubmit && !form.beforeSubmit()) return
      if (result().errors.length) {
        setError(result().errors[0])
        return
      }
      form.onSubmit(Object.keys(result().answer).length > 0 ? result().answer : undefined)
    }

    const Field: Component<{ field: FormField }> = (props) => {
      const field = () => props.field
      const string = () => {
        const current = field()
        return current.type === "string" ? current : undefined
      }
      const multiple = () => {
        const current = field()
        return current.type === "multiselect" ? current : undefined
      }
      const external = () => {
        const current = field()
        return current.type === "external" ? current : undefined
      }
      const free = () => string()?.custom === true
      const options = (): FormOption[] => string()?.options ?? []

      return (
        <Switch>
          <Match when={external()}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <Button
                variant="secondary"
                size="large"
                type="button"
                onClick={() => {
                  set(field(), true)
                  if (external()?.url) openExternal(external()!.url)
                }}
              >
                {label(field())}
              </Button>
              <Show when={external()?.description}>
                <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--text-weak-base)" }}>
                  {external()?.description}
                </span>
              </Show>
              <Show when={invalid(field()) && error()}>
                <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}>
                  {error()}
                </span>
              </Show>
            </div>
          </Match>
          <Match when={field().type === "boolean"}>
            <Checkbox checked={!!value(field())} onChange={(checked) => set(field(), checked)}>
              {label(field())}
            </Checkbox>
          </Match>
          <Match when={multiple()}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <span
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  "font-weight": "500",
                  color: "var(--text-weak-base)",
                }}
              >
                {label(field())}
              </span>
              <For each={multiple()?.options ?? []}>
                {(option) => {
                  const selected = () => (Array.isArray(value(field())) ? (value(field()) as string[]) : [])
                  return (
                    <Checkbox
                      checked={selected().includes(option.value)}
                      onChange={(checked) =>
                        set(
                          field(),
                          checked
                            ? [...selected(), option.value]
                            : selected().filter((value) => value !== option.value),
                        )
                      }
                    >
                      {optionText(option)}
                    </Checkbox>
                  )
                }}
              </For>
              <Show when={multiple()?.custom}>
                <TextField
                  type="text"
                  label={label(field())}
                  value={custom[field().key] ?? ""}
                  onChange={(next) => {
                    setError(undefined)
                    setCustom(field().key, next)
                  }}
                />
              </Show>
              <Show when={invalid(field()) && error()}>
                <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}>
                  {error()}
                </span>
              </Show>
            </div>
          </Match>
          <Match when={free() || options().length === 0}>
            <TextField
              type={field().type === "number" || field().type === "integer" ? "number" : "text"}
              autocomplete="off"
              spellcheck={false}
              label={label(field())}
              placeholder={string()?.placeholder}
              value={String(value(field()) ?? "")}
              onChange={(next) => set(field(), next)}
              validationState={invalid(field()) ? "invalid" : undefined}
              error={invalid(field()) ? error() : undefined}
            />
          </Match>
          <Match when={options().length > 0}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <span
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  "font-weight": "500",
                  color: "var(--text-weak-base)",
                }}
              >
                {label(field())}
              </span>
              <Select
                options={options()}
                current={options().find((option: FormOption) => option.value === value(field()))}
                value={(option: FormOption) => option.value}
                label={(option: FormOption) => optionText(option)}
                onSelect={(option: FormOption | undefined) => set(field(), option?.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
              <Show when={invalid(field()) && error()}>
                <span style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground)" }}>
                  {error()}
                </span>
              </Show>
            </div>
          </Match>
        </Switch>
      )
    }

    return (
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        {form.leading}
        <For each={visible()}>{(field) => <Field field={field} />}</For>
        {form.footer ?? undefined}
        <div class="dialog-confirm-actions provider-connect-actions">
          <Button variant="ghost" size="large" type="button" onClick={back}>
            {language.t("common.goBack")}
          </Button>
          <Button variant="primary" size="large" type="submit" disabled={form.busy}>
            {language.t("common.submit")}
          </Button>
        </div>
      </form>
    )
  }

  const MethodSelection: Component = () => {
    return (
      <div class="dialog-confirm-body" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
        <div class="provider-connect-body">{language.t("provider.connect.selectMethod", { provider: name() })}</div>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <For each={methods()}>
            {(method, index) => (
              <Button variant="secondary" size="large" onClick={() => selectMethod(index())}>
                {method.type === "key" ? method.label || language.t("provider.connect.method.apiKey") : method.label}
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

    function submit(answer: FormAnswer | undefined) {
      connect(value().trim(), answer)
    }

    return (
      <MethodForm
        fields={methodFields(method())}
        busy={state.phase === "connecting"}
        leading={
          <>
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
              onChange={(next) => {
                setValue(next)
                if (state.field === "apiKey") setState({ ...state, error: undefined, field: undefined })
              }}
              validationState={state.field === "apiKey" ? "invalid" : undefined}
              error={state.field === "apiKey" ? state.error : undefined}
            />
          </>
        }
        footer={
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
        }
        beforeSubmit={() => {
          if (value().trim()) {
            if (state.field === "apiKey") setState({ ...state, error: undefined, field: undefined })
            return true
          }
          setState({ ...state, error: language.t("provider.connect.apiKey.required"), field: "apiKey" })
          return false
        }}
        onSubmit={submit}
      />
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
          onChange={(next) => {
            setValue(next)
            if (state.error) setState({ ...state, error: undefined })
          }}
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

  const OAuthPromptsView: Component = () => (
    <MethodForm
      fields={methodFields(method())}
      busy={state.phase === "authorizing"}
      onSubmit={(answer) => authorize(answer)}
    />
  )

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
    <Dialog title={heading()} fit>
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
