/**
 * TUI wizard for creating, editing, and deleting custom OpenAI-compatible
 * providers. Mirrors the VS Code extension's `CustomProviderDialog` flow:
 *
 *   Collect id/name/baseURL/key → fetch /models → pick models → save to
 *   global kilo.json via `PATCH /global/config`, then write/clear the API
 *   key via `PUT|DELETE /auth/:providerID`, then `POST /global/dispose`
 *   and refresh the provider list.
 *
 * Kilo-owned file (path contains `kilocode`) — no upstream merge markers.
 */

import { createEffect, createSignal, Match, onMount, Switch, type JSX } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import type { Config, ProviderConfig } from "@kilocode/sdk/v2"
import { TextAttributes } from "@opentui/core"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { errorMessage } from "@/util/error"
import { DialogModel } from "@tui/component/dialog-model"
import {
  buildPatchWithDeletions,
  buildSanitized,
  fetchModels,
  isCustomProvider,
  normalizeProviderID,
  parseSecret,
  validateBaseURL,
  type CustomProviderModel,
  type CustomProviderSecret,
  type SanitizedCustomProvider,
} from "./custom-provider"

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export type WizardMode = "add" | "edit"

type WizardStore = {
  mode: WizardMode
  providerID: string
  name: string
  baseURL: string
  key: string
  fetched: CustomProviderModel[]
  selected: string[]
  manual: CustomProviderModel[]
  fetchError?: string
}

/** Plain snapshot of a WizardStore — used to pass across dialog.replace
 *  boundaries so the next mount's createStore gets a real object, not a
 *  reactive proxy from the previous (unmounting) component. */
function snapshot(store: WizardStore): WizardStore {
  return {
    mode: store.mode,
    providerID: store.providerID,
    name: store.name,
    baseURL: store.baseURL,
    key: store.key,
    fetched: store.fetched.slice(),
    selected: store.selected.slice(),
    manual: store.manual.slice(),
    fetchError: store.fetchError,
  }
}

/**
 * Launch the wizard. `replace` is the dialog context's `replace`. For edit
 * mode, `providerID` identifies the existing provider.
 */
export function launchCustomProvider(input: {
  mode: WizardMode
  providerID?: string
  replace: (el: () => JSX.Element) => void
}) {
  const init: WizardStore = {
    mode: input.mode,
    providerID: input.providerID ?? "",
    name: "",
    baseURL: "",
    key: "",
    fetched: [],
    selected: [],
    manual: [],
  }
  input.replace(() => <Wizard initial={init} />)
}

export async function removeCustomProvider(
  providerID: string,
  ctx: {
    sdk: ReturnType<typeof useSDK>
    sync: ReturnType<typeof useSync>
    toast: ReturnType<typeof useToast>
    dialog: ReturnType<typeof useDialog>
  },
): Promise<void> {
  const { sdk, sync, toast, dialog } = ctx
  const confirmed = await confirmAction(
    `Delete custom provider "${providerID}"? This removes it from kilo.json and clears its credential.`,
  )
  if (!confirmed) return
  try {
    const globalResult = await sdk.client.global.config.get({ throwOnError: true })
    const globalConfig: Config = (globalResult.data as Config | undefined) ?? {}
    if (!isCustomProvider(globalConfig.provider?.[providerID])) {
      toast.show({ variant: "error", message: `${providerID} is not a custom provider` })
      return
    }
    const disabled = (globalConfig.disabled_providers ?? []).filter((id) => id !== providerID)
    await sdk.client.global.config.update(
      {
        config: {
          provider: { [providerID]: null },
          disabled_providers: disabled,
        },
      },
      { throwOnError: true },
    )
    await sdk.client.auth.remove({ providerID }, { throwOnError: true }).catch(() => undefined)
    await sdk.client.global.dispose().catch(() => undefined)
    await sync.bootstrap()
    toast.show({ variant: "success", message: `Removed ${providerID}` })
    dialog.clear()
  } catch (err) {
    toast.show({ variant: "error", message: errorMessage(err) || "Failed to remove custom provider" })
  }
}

// ---------------------------------------------------------------------------
// Confirm helper
// ---------------------------------------------------------------------------

function confirmAction(message: string): Promise<boolean> {
  const dialog = useDialog()
  return new Promise((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt
          title="Confirm"
          placeholder="Type 'yes' to confirm"
          description={() => (
            <text fg={useTheme().theme.textMuted} wrapMode="word">
              {message}
            </text>
          )}
          onConfirm={(value) => {
            dialog.clear()
            resolve(value.trim().toLowerCase() === "yes")
          }}
          onCancel={() => {
            dialog.clear()
            resolve(false)
          }}
        />
      ),
      () => {
        dialog.clear()
        resolve(false)
      },
    )
  })
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function Wizard(props: { initial: WizardStore }) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const [state, setState] = createStore<WizardStore>(unwrap(props.initial))
  const replace = (el: () => JSX.Element) => dialog.replace(el)

  // Prefill from existing config on first mount in edit mode.
  if (state.mode === "edit" && !state.name) {
    const existing = sync.data.globalConfig?.provider?.[state.providerID] as ProviderConfig | null | undefined
    if (existing) {
      const envName = existing.env?.[0]
      setState({
        name: existing.name ?? state.providerID,
        baseURL: existing.options?.baseURL ?? "",
        key: envName ? `{env:${envName}}` : "",
      })
      if (existing.models) {
        const ids = Object.keys(existing.models).filter((id) => existing.models?.[id] !== null)
        setState("selected", ids)
      }
    }
  }

  // Reject editing a non-custom provider.
  if (state.mode === "edit" && !isCustomProvider(sync.data.globalConfig?.provider?.[state.providerID])) {
    queueMicrotask(() => {
      toast.show({ variant: "error", message: `${state.providerID} is not a custom provider` })
      dialog.clear()
    })
    return <></>
  }

  // Step 1 — provider id (add only).
  if (state.mode === "add" && !state.providerID) {
    return (
      <DialogPrompt
        title="Custom provider — id"
        placeholder="my-provider"
        description={() => (
          <text fg={useTheme().theme.textMuted} wrapMode="word">
            Lowercase letters, digits, hyphens, underscores. Must be unique.
          </text>
        )}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const id = normalizeProviderID(value)
          if (!id) {
            toast.show({
              variant: "error",
              message:
                "Provider ids must start with a lowercase letter or number and only use lowercase letters, numbers, hyphens, and underscores",
            })
            return
          }
          if (sync.data.globalConfig?.provider?.[id]) {
            toast.show({
              variant: "error",
              message: `Provider "${id}" already exists. Select it in the provider list to edit.`,
            })
            return
          }
          setState({ providerID: id, name: id })
        }}
      />
    )
  }

  // Step 2 — display name.
  if (!state.name) {
    return (
      <DialogPrompt
        title="Custom provider — display name"
        placeholder="Display name"
        value={state.providerID}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const name = value.trim()
          if (!name) {
            toast.show({ variant: "error", message: "Display name is required" })
            return
          }
          setState("name", name)
        }}
      />
    )
  }

  // Step 3 — base URL.
  if (!state.baseURL) {
    return (
      <DialogPrompt
        title="Custom provider — base URL"
        placeholder="https://api.example.com/v1"
        value={state.baseURL}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const err = validateBaseURL(value)
          if (err) {
            toast.show({ variant: "error", message: err })
            return
          }
          setState("baseURL", value.trim())
        }}
      />
    )
  }

  // Step 4 — API key (or {env:VAR}).
  if (state.mode === "add" && !state.key) {
    return (
      <DialogPrompt
        title="Custom provider — API key"
        placeholder="API key or {env:VAR_NAME}"
        description={() => (
          <text fg={useTheme().theme.textMuted} wrapMode="word">
            Enter the API key, or {"{env:VAR_NAME}"} to read it from an environment variable at runtime.
          </text>
        )}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const parsed = parseSecret(value)
          if ("error" in parsed) {
            toast.show({ variant: "error", message: parsed.error })
            return
          }
          if (parsed.kind === "preserve") {
            toast.show({ variant: "error", message: "API key or {env:VAR} is required" })
            return
          }
          setState("key", parsed.kind === "key" ? parsed.key : `{env:${parsed.name}}`)
        }}
      />
    )
  }

  if (state.mode === "edit") {
    const existing = sync.data.globalConfig?.provider?.[state.providerID] as ProviderConfig | null | undefined
    const envName = existing?.env?.[0]
    return (
      <DialogPrompt
        title={`Edit ${state.providerID} — API key`}
        placeholder={envName ? `leave blank to keep {env:${envName}}` : "leave blank to keep current"}
        description={() => (
          <text fg={useTheme().theme.textMuted} wrapMode="word">
            Leave blank to keep the current credential. Enter an API key to replace it, or {"{env:VAR_NAME}"} to switch
            to an environment variable.
          </text>
        )}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          const trimmed = value.trim()
          if (!trimmed) {
            // preserve — re-render will fall through to ModelsStep
            return
          }
          const parsed = parseSecret(trimmed)
          if ("error" in parsed) {
            toast.show({ variant: "error", message: parsed.error })
            return
          }
          if (parsed.kind === "key") setState("key", parsed.key)
          else if (parsed.kind === "env") setState("key", `{env:${parsed.name}}`)
        }}
      />
    )
  }

  // Step 5 — fetch + picker.
  return <ModelsStep state={state} setState={setState} onCancel={() => dialog.clear()} />
}

// ---------------------------------------------------------------------------
// Models step
// ---------------------------------------------------------------------------

function ModelsStep(props: {
  state: WizardStore
  setState: ReturnType<typeof createStore<WizardStore>>[1]
  onCancel: () => void
}) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const sdk = useSDK()

const secretForFetch = (): string | undefined => {
    const parsed = parseSecret(props.state.key)
    if ("error" in parsed) return undefined
    if (parsed.kind !== "key") return undefined
    return parsed.key
  }

  const [loading, setLoading] = createSignal(false)
  const [retryTick, setRetryTick] = createSignal(0)

  // Run fetch on mount, on baseURL/key change, or on retry. Skip when we
  // already have fetched results and the user hasn't asked to retry — this
  // avoids refetching every time the picker remounts after addManual.
  createEffect(() => {
    props.state.baseURL
    secretForFetch()
    retryTick()
    if (props.state.fetched.length > 0 && retryTick() === 0) return
    setLoading(true)
    props.setState("fetchError", undefined)
    void (async () => {
      const result = await fetchModels(props.state.baseURL, secretForFetch())
      if (result.ok) {
        props.setState("fetched", result.models)
        // An empty result is treated as a fetch failure so the user sees the
        // retry/manual flow instead of an apparently empty picker.
        if (result.models.length === 0) {
          props.setState("fetchError", "Provider returned no models")
        } else {
          props.setState("fetchError", undefined)
        }
      } else {
        props.setState("fetchError", result.error)
      }
      setLoading(false)
    })()
  })

  const all = (): CustomProviderModel[] => {
    const ids = new Set(props.state.fetched.map((m) => m.id))
    const merged = [...props.state.fetched]
    for (const m of props.state.manual) if (!ids.has(m.id)) merged.push(m)
    merged.sort((a, b) => a.id.localeCompare(b.id))
    return merged
  }

  const isSelected = (id: string) => props.state.selected.includes(id)
  const toggle = (id: string) =>
    props.setState(
      "selected",
      produce((arr: string[]) => {
        const idx = arr.indexOf(id)
        if (idx >= 0) arr.splice(idx, 1)
        else arr.push(id)
      }),
    )

  const openAddModel = () => {
    dialog.replace(() => (
      <AddModelPrompt
        onCancel={remountPicker}
        onDone={(id, name) => {
          props.setState(
            "manual",
            produce((arr: CustomProviderModel[]) => {
              if (!arr.find((m) => m.id === id)) arr.push({ id, name })
            }),
          )
          props.setState(
            "selected",
            produce((arr: string[]) => {
              if (!arr.includes(id)) arr.push(id)
            }),
          )
          remountPicker()
        }}
      />
    ))
  }

  const remountPicker = () => {
    dialog.replace(() => (
      <ModelsStep state={props.state} setState={props.setState} onCancel={props.onCancel} />
    ))
  }

  const done = async () => {
    if (props.state.selected.length === 0) {
      toast.show({ variant: "error", message: "Select at least one model" })
      return
    }
    await saveAndOpen(props.state, sdk)
  }

  const phase = () => {
    if (loading()) return "fetching"
    if (props.state.fetchError) return "error"
    return "ready"
  }

  const titleForPhase = () => {
    const n = props.state.selected.length
    if (phase() === "fetching") return `Custom provider — fetching models…`
    if (phase() === "error") return `Custom provider — models (fetch failed, ${n} selected)`
    return `Custom provider — models (${n} selected)`
  }

  const options = (): DialogSelectOption<string>[] => {
    const opts: DialogSelectOption<string>[] = []
    if (phase() === "error") {
      opts.push({
        title: "Retry fetch",
        description: props.state.fetchError,
        value: "retry",
        category: "Fetch",
        onSelect: () => {
          setRetryTick((n) => n + 1)
        },
      })
    }
    for (const m of all()) {
      opts.push({
        title: `${isSelected(m.id) ? "✓" : " "} ${m.name}`,
        description: m.id,
        value: `model:${m.id}`,
        category: "Models",
        onSelect: () => toggle(m.id),
      })
    }
    opts.push({
      title: "+ Add model manually",
      value: "manual",
      category: "Models",
      onSelect: () => {
        openAddModel()
      },
    })
    opts.push({
      title: `Done (${props.state.selected.length} selected)`,
      value: "done",
      category: "Models",
      disabled: props.state.selected.length === 0,
      onSelect: () => {
        void done()
      },
    })
    return opts
  }

  return (
    <Switch>
      <Match when={phase() === "fetching"}>
        <FetchingView baseURL={props.state.baseURL} onCancel={props.onCancel} />
      </Match>
      <Match when={phase() !== "fetching"}>
        <DialogSelect
          title={titleForPhase()}
          titleView={
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {titleForPhase()}
              </text>
              <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                esc
              </text>
            </box>
          }
          options={options()}
        />
      </Match>
    </Switch>
  )
}

function FetchingView(props: { baseURL: string; onCancel: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Custom provider — fetching models…
        </text>
        <text fg={theme.textMuted} onMouseUp={dialog.clear}>
          esc
        </text>
      </box>
      <box gap={1}>
        <text fg={theme.textMuted} wrapMode="word">
          Contacting {props.baseURL.replace(/\/+$/, "")}/models …
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          This may take a few seconds. Press esc to cancel.
        </text>
      </box>
    </box>
  )
}

/**
 * Two-step "Add model manually" flow: prompt for id, then for name, then
 * call onDone(id, name). Mounted via dialog.replace from the picker so the
 * picker cleanly unmounts and this component owns the dialog stack. Each
 * inner prompt uses dialog.replace as well, returning to this component's
 * own onCancel/onDone.
 */
function AddModelPrompt(props: { onCancel: () => void; onDone: (id: string, name: string) => void }) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  onMount(() => {
    dialog.replace(() => (
      <DialogPrompt
        title="Add model — id"
        placeholder="model-id"
        description={() => (
          <text fg={theme.textMuted} wrapMode="word">
            The id the provider expects in API requests.
          </text>
        )}
        onCancel={() => {
          dialog.clear()
          props.onCancel()
        }}
        onConfirm={(value) => {
          const id = value.trim()
          if (!id) {
            toast.show({ variant: "error", message: "Model id is required" })
            return
          }
          dialog.replace(() => (
            <DialogPrompt
              title="Add model — name"
              placeholder={id}
              value={id}
              description={() => (
                <text fg={theme.textMuted} wrapMode="word">
                  Display name (press enter to use the id).
                </text>
              )}
              onCancel={() => {
                dialog.clear()
                props.onCancel()
              }}
              onConfirm={(nameValue) => {
                dialog.clear()
                const name = (nameValue ?? id).trim() || id
                props.onDone(id, name)
              }}
            />
          ))
        }}
      />
    ))
  })
  return <></>
}

// ---------------------------------------------------------------------------
// Save pipeline
// ---------------------------------------------------------------------------

async function saveAndOpen(state: WizardStore, sdk: ReturnType<typeof useSDK>) {
  const toast = useToast()
  const dialog = useDialog()
  const sync = useSync()

  const secret = parseSecret(state.key)
  if ("error" in secret) {
    toast.show({ variant: "error", message: secret.error })
    return
  }
  // After narrowing, secret is CustomProviderSecret.
  const models: CustomProviderModel[] = state.selected.map((id) => {
    const found = state.fetched.find((m) => m.id === id) ?? state.manual.find((m) => m.id === id)
    return { id, name: found?.name ?? id }
  })

  const sanitized = buildSanitized({
    id: state.providerID,
    name: state.name,
    baseURL: state.baseURL,
    secret,
    models,
  })
  if ("error" in sanitized) {
    toast.show({ variant: "error", message: sanitized.error })
    return
  }

  try {
    const globalResult = await sdk.client.global.config.get({ throwOnError: true })
    const globalConfig: Config = (globalResult.data as Config | undefined) ?? {}
    const existing = globalConfig.provider?.[state.providerID] as ProviderConfig | null | undefined
    const patch = buildPatchWithDeletions(existing, sanitized as SanitizedCustomProvider)
    const disabled = (globalConfig.disabled_providers ?? []).filter((id) => id !== state.providerID)

    await sdk.client.global.config.update(
      {
        config: {
          provider: { [state.providerID]: patch as unknown as ProviderConfig },
          disabled_providers: disabled,
        },
      },
      { throwOnError: true },
    )

    const action = resolveAuthAction(state.mode, secret)
    if (action.kind === "set") {
      await sdk.client.auth.set(
        { providerID: state.providerID, auth: { type: "api", key: action.key } },
        { throwOnError: true },
      )
    } else if (action.kind === "clear") {
      await sdk.client.auth.remove({ providerID: state.providerID }, { throwOnError: true }).catch(() => undefined)
    }

    await sdk.client.global.dispose().catch(() => undefined)
    await sync.bootstrap()

    toast.show({ variant: "success", message: `Saved ${state.providerID}` })
    dialog.replace(() => <DialogModel providerID={state.providerID} />)
  } catch (err) {
    toast.show({ variant: "error", message: errorMessage(err) || "Failed to save custom provider" })
  }
}

type AuthAction = { kind: "set"; key: string } | { kind: "clear" } | { kind: "preserve" }

function resolveAuthAction(mode: WizardMode, secret: CustomProviderSecret): AuthAction {
  if (mode === "add") {
    if (secret.kind === "key") return { kind: "set", key: secret.key }
    if (secret.kind === "env") return { kind: "clear" }
    return { kind: "preserve" }
  }
  // edit: empty → preserve; key → set; env → clear (drops stored key, relies on env).
  if (secret.kind === "preserve") return { kind: "preserve" }
  if (secret.kind === "env") return { kind: "clear" }
  return { kind: "set", key: secret.key }
}