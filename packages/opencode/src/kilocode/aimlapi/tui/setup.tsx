// kilocode_change - new file
//
// AI/ML API guided onboarding — TUI screens.
//
// Rendered when the user picks "aimlapi.com" in the provider dialog (see
// `selectProvider`). Screen sequence, copy and behavior follow the shared
// AIMLAPI onboarding spec; all protocol logic lives in ../flow.ts.

import { TextAttributes } from "@opentui/core"
import { Match, Show, Switch, createSignal, onCleanup, type JSX } from "solid-js"
import open from "open"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useBindings } from "@tui/keymap"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Link } from "@tui/ui/link"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { AimlapiFlow, COPY, type FlowPhase, type FlowResult } from "../flow"

export const PROVIDER_ID = "aimlapi"

type ModelComponent = (props: { providerID?: string }) => JSX.Element

export function selectProvider(input: {
  providerID: string
  replace(component: () => JSX.Element): void
  model: ModelComponent
}) {
  if (input.providerID !== PROVIDER_ID) return false
  input.replace(() => <AimlapiSetup model={input.model} />)
  return true
}

export function AimlapiSetup(props: { model: ModelComponent }) {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const Model = props.model

  const [phase, setPhase] = createSignal<FlowPhase>({ id: "busy", message: "" })
  const [result, setResult] = createSignal<FlowResult>()
  const [autoTopUp, setAutoTopUp] = createSignal(true)
  const [saving, setSaving] = createSignal(false)

  const flow = new AimlapiFlow({
    openUrl: async (url) => {
      await open(url)
    },
    change: setPhase,
    complete: setResult,
  })

  // Enter the state machine before the first render (not in onMount): the
  // dialog inserts this component through a tracked render effect, and a phase
  // transition during the mount flush recurses opentui's update loop.
  flow.start(sync.data.provider_next.connected.includes(PROVIDER_ID))
  onCleanup(() => flow.cancel())

  /** Persist the issued/pasted key and continue to the model picker (S8). */
  const finalize = async () => {
    if (saving()) return
    const r = result()
    if (!r) return
    setSaving(true)
    try {
      await sdk.client.auth.set({
        providerID: PROVIDER_ID,
        auth: { type: "api", key: r.apiKey },
      })
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      dialog.replace(() => <Model providerID={PROVIDER_ID} />)
    } finally {
      setSaving(false)
    }
  }

  /** S12 "Continue with your saved API key" — provider is already connected. */
  const continueSaved = () => {
    dialog.replace(() => <Model providerID={PROVIDER_ID} />)
  }

  // Enter advances the terminal screens (S7 success / S11 ready).
  useBindings(() => ({
    enabled: phase().id === "ready" || phase().id === "topup-success",
    priority: 1,
    bindings: [{ key: "return", desc: "submit", group: "Dialog", cmd: () => void finalize() }],
  }))

  // Tab toggles auto top-up on the credits screen (S5).
  useBindings(() => ({
    enabled: phase().id === "credits",
    priority: 2,
    bindings: [{ key: "tab", desc: "toggle auto top-up", group: "Dialog", cmd: () => setAutoTopUp((v) => !v) }],
  }))

  const errorLine = (error?: string) => (
    <Show when={error}>{(message) => <text fg={theme.error}>{message()}</text>}</Show>
  )

  const footer = () => (
    <text fg={theme.text}>
      enter <span style={{ fg: theme.textMuted }}>submit</span>
    </text>
  )

  // The root must stay a static element: the dialog's render effect unwraps a
  // function root (what a bare <Switch> compiles to) inside its tracked scope,
  // so a dynamic root re-creates the whole component on every phase change.
  return (
    <box>
      <Switch>
        <Match when={phase().id === "reconfigure"}>
          <DialogSelect
            title={COPY.reconfigureTitle}
            options={[
              { value: "continue", title: COPY.reconfigureContinue, onSelect: () => continueSaved() },
              { value: "new-key", title: COPY.reconfigureNewKey, onSelect: () => flow.chooseReconfigure() },
            ]}
          />
        </Match>

        <Match when={phase().id === "choice"}>
          <DialogSelect
            title={COPY.choiceTitle}
            options={[
              { value: "new-user", title: COPY.choiceNewUser, onSelect: () => flow.chooseNewUser() },
              { value: "have-key", title: COPY.choiceHaveKey, onSelect: () => flow.chooseHaveKey() },
            ]}
          />
        </Match>

        <Match when={phase().id === "paste-key"}>
          <DialogPrompt
            title={COPY.pasteKeyTitle}
            placeholder={COPY.pasteKeyPlaceholder}
            description={() => errorLine((phase() as Extract<FlowPhase, { id: "paste-key" }>).error)}
            onConfirm={(value) => void flow.submitKey(value)}
            onCancel={() => dialog.clear()}
          />
        </Match>

        <Match when={phase().id === "email"}>
          <DialogPrompt
            title={COPY.emailTitle}
            placeholder={COPY.emailPlaceholder}
            description={() => errorLine((phase() as Extract<FlowPhase, { id: "email" }>).error)}
            onConfirm={(value) => void flow.submitEmail(value)}
            onCancel={() => dialog.clear()}
          />
        </Match>

        <Match when={phase().id === "code"}>
          <DialogPrompt
            title={COPY.codeTitle((phase() as Extract<FlowPhase, { id: "code" }>).email)}
            placeholder={COPY.codePlaceholder}
            description={() => errorLine((phase() as Extract<FlowPhase, { id: "code" }>).error)}
            onConfirm={(value) => void flow.submitCode(value)}
            onCancel={() => dialog.clear()}
          />
        </Match>

        <Match when={phase().id === "credits"}>
          <DialogPrompt
            title={COPY.creditsTitle}
            value="25"
            description={() => (
              <box gap={0}>
                <text fg={theme.text}>
                  {COPY.creditsAutoTopUp} <span style={{ fg: theme.textMuted }}>(Tab)</span>:{" "}
                  <span style={{ fg: autoTopUp() ? theme.text : theme.textMuted }}>on</span>{" "}
                  <span style={{ fg: autoTopUp() ? theme.textMuted : theme.text }}>off</span>
                </text>
                {errorLine((phase() as Extract<FlowPhase, { id: "credits" }>).error)}
              </box>
            )}
            onConfirm={(value) => void flow.submitAmount(value, autoTopUp())}
            onCancel={() => dialog.clear()}
          />
        </Match>

        <Match when={phase().id === "checkout"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text attributes={TextAttributes.BOLD} fg={theme.warning}>
                {COPY.checkoutTitle}
              </text>
              <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                esc
              </text>
            </box>
            <text fg={theme.text} wrapMode="word">
              {COPY.checkoutBody}
            </text>
            <Show when={(phase() as Extract<FlowPhase, { id: "checkout" }>).payUrl}>
              {(url) => <Link href={url()} fg={theme.primary} wrapMode="word" />}
            </Show>
          </box>
        </Match>

        <Match when={phase().id === "topup-success"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text attributes={TextAttributes.BOLD} fg={theme.success}>
                {COPY.topupSuccessTitle((phase() as Extract<FlowPhase, { id: "topup-success" }>).amountUsd)}
              </text>
              <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                esc
              </text>
            </box>
            <text fg={theme.text} wrapMode="word">
              {COPY.topupSuccessBody((phase() as Extract<FlowPhase, { id: "topup-success" }>).email)}
            </text>
            {footer()}
          </box>
        </Match>

        <Match when={phase().id === "ready"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text attributes={TextAttributes.BOLD} fg={theme.success}>
                {COPY.readyTitle}
              </text>
              <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                esc
              </text>
            </box>
            {footer()}
          </box>
        </Match>

        <Match when={phase().id === "busy"}>
          <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
            <text fg={theme.textMuted}>{(phase() as Extract<FlowPhase, { id: "busy" }>).message}</text>
          </box>
        </Match>
      </Switch>
    </box>
  )
}
