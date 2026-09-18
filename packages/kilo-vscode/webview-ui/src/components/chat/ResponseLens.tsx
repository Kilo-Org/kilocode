import {
  type Accessor,
  type Component,
  type ParentComponent,
  ErrorBoundary,
  Show,
  For,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { showToast } from "@kilocode/kilo-ui/toast"
import { responseLensSettings, type ExplainBrieflyResult } from "../../../../src/shared/response-lens"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useVSCode } from "../../context/vscode"
import { responseLensContext } from "../../utils/response-lens"
import { responseLensReferences } from "../../utils/response-lens-references"
import { assistantCaptureOwned } from "../../utils/assistant-selection"
import { ResponseLensSettings } from "../shared/ResponseLensSettings"
import { SelectionToolbar, type SelectionCapture } from "./SelectionToolbar"
import "../../styles/response-lens.css"

type Snapshot = ReturnType<typeof responseLensContext> & {
  capture: SelectionCapture
  references: ReturnType<typeof responseLensReferences>
}

export const ResponseLensBoundary: ParentComponent = (props) => {
  const language = useLanguage()
  return (
    <ErrorBoundary
      fallback={(error) => {
        console.error("[Kilo New] Response Lens view failed:", error)
        return <span role="alert">{language.t("responseLens.unavailable")}</span>
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

export const ResponseLens: Component<{
  transcript: Accessor<HTMLElement | undefined>
  streamingMessageIDs: Accessor<Set<string>>
  disabled: Accessor<boolean>
  editing: Accessor<boolean>
  onAdd: (capture: SelectionCapture) => void
  focus: () => HTMLElement | undefined
}> = (props) => {
  const session = useSession()
  const vscode = useVSCode()
  const config = useConfig()
  const language = useLanguage()
  const settings = () => responseLensSettings(config.settings()["chat.responseLens"])
  const enabled = createMemo(() => settings().enabled)
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const preferences = createMemo(() => {
    const value = snapshot()
    if (!value) return
    const model = settings().model ?? session.selected(value.capture.sessionID)
    return JSON.stringify([settings().level, model?.providerID, model?.modelID])
  })
  const [request, setRequest] = createSignal<string>()
  const [result, setResult] = createSignal<ExplainBrieflyResult>()
  const [error, setError] = createSignal<string>()
  let focus: HTMLElement | undefined

  const cancel = () => {
    const id = request()
    setRequest(undefined)
    if (id) vscode.postMessage({ type: "cancelExplainBriefly", requestId: id })
  }
  const close = (restore = false) => {
    cancel()
    setSnapshot(undefined)
    if (restore) {
      const target = focus?.isConnected ? focus : props.focus()
      requestAnimationFrame(() => target?.isConnected && target.focus())
    }
  }
  const owned = (capture: SelectionCapture) =>
    assistantCaptureOwned(capture, {
      transcript: props.transcript(),
      sessionID: session.currentSessionID(),
      streaming: props.streamingMessageIDs(),
    })
  const explain = () => {
    cancel()
    setResult(undefined)
    setError(undefined)
    const value = snapshot()
    if (!value || !settings().enabled) return
    if (!owned(value.capture)) return close()
    if (!value.capture.text.trim() || value.capture.text.length > 4000) {
      setError(language.t("responseLens.selectionLimit"))
      return
    }
    if (value.references.length > 2) {
      setError(language.t("responseLens.referenceLimit"))
      return
    }
    const model = settings().model ?? session.selected(value.capture.sessionID)
    if (!model) {
      setError(language.t("responseLens.noModel"))
      return
    }
    const id = crypto.randomUUID()
    setRequest(id)
    vscode.postMessage({
      type: "explainBriefly",
      requestId: id,
      sessionID: value.capture.sessionID,
      messageID: value.capture.messageID,
      text: value.capture.text,
      level: settings().level,
      model: { ...model },
      context: value.context,
      references: value.references,
    })
  }
  const open = (capture: SelectionCapture) => {
    close()
    if (!settings().enabled || props.editing() || !owned(capture)) return
    focus =
      document.activeElement instanceof HTMLElement && !document.activeElement.closest(".selection-toolbar")
        ? document.activeElement
        : props.focus()
    setSnapshot({
      capture,
      ...responseLensContext(capture, session.visibleMessages(), session.getParts),
      references: responseLensReferences(capture),
    })
    explain()
  }
  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "explainBrieflyResult" && message.type !== "explainBrieflyError") return
    const value = snapshot()
    if (!value || message.requestId !== request()) return
    if (!settings().enabled || !owned(value.capture)) return close()
    setRequest(undefined)
    if (message.type === "explainBrieflyError") setError(message.error)
    else setResult(message)
  })
  const copy = async () => {
    const text = result()?.text
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn("[Kilo New] Failed to copy explanation:", error)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("annotations.copyFailed"),
      })
    }
  }
  createEffect(on([session.currentSessionID, props.transcript, enabled], () => close(), { defer: true }))
  createEffect(
    on(props.editing, (editing) => {
      if (editing) close()
    }),
  )
  createEffect(
    on(
      [snapshot, preferences],
      ([value], previous) => {
        if (!value || value !== previous?.[0]) return
        cancel()
        setResult(undefined)
        setError(language.t("responseLens.settingsChanged"))
      },
      { defer: true },
    ),
  )
  onMount(() => {
    const selection = (event: PointerEvent) => {
      if (snapshot() && event.target instanceof Node && props.transcript()?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (!snapshot() || event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      event.stopImmediatePropagation()
      close(true)
    }
    window.addEventListener("keydown", escape, true)
    window.addEventListener("pointerdown", selection, true)
    onCleanup(() => {
      window.removeEventListener("keydown", escape, true)
      window.removeEventListener("pointerdown", selection, true)
    })
  })
  onCleanup(() => {
    cancel()
    unsubscribe()
  })

  return (
    <>
      <SelectionToolbar
        transcript={props.transcript}
        sessionID={session.currentSessionID}
        streamingMessageIDs={props.streamingMessageIDs}
        disabled={props.disabled}
        enabled={enabled}
        onSelection={(capture) => {
          const previous = snapshot()?.capture
          if (
            previous &&
            (previous.text !== capture.text ||
              previous.row !== capture.row ||
              previous.rect.top !== capture.rect.top ||
              previous.rect.left !== capture.rect.left)
          )
            close()
        }}
        onAdd={(capture) => {
          close()
          props.onAdd(capture)
        }}
        onExplain={open}
      />
      <Show when={snapshot()}>
        {(value) => (
          <Popover
            open={true}
            class="response-lens-popover"
            contentLabel={language.t("responseLens.explain")}
            placement="top"
            gutter={6}
            overflowPadding={8}
            slide={true}
            getAnchorRect={() => value().capture.rect}
            triggerAs="span"
            triggerProps={{ class: "annotation-popover-anchor", tabIndex: -1, "aria-hidden": "true" }}
          >
            <div
              data-component="response-lens"
              class="response-lens-body"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <div class="response-lens-header">
                <strong>{language.t("responseLens.explain")}</strong>
                <Button variant="ghost" size="small" data-autofocus onClick={() => close(true)}>
                  {language.t("responseLens.close")}
                </Button>
              </div>
              <div class="annotation-popover-selection" role="note">
                {value().capture.text}
              </div>
              <Show when={value().insufficient}>
                <p class="response-lens-hint">{language.t("responseLens.insufficient")}</p>
              </Show>
              <div aria-live="polite" aria-busy={!!request()}>
                <Show when={request()}>
                  <div class="response-lens-loading">
                    <Spinner />
                    {language.t(value().references.length ? "responseLens.readingSources" : "responseLens.loading")}
                  </div>
                </Show>
                <Show when={error()}>
                  <p role="alert">{error()}</p>
                </Show>
                <Show when={result()}>
                  {(answer) => (
                    <>
                      <p class="response-lens-result">{answer().text}</p>
                      <Show when={answer().truncated}>
                        <p class="response-lens-hint">{language.t("responseLens.truncated")}</p>
                      </Show>
                      <p class="response-lens-hint">
                        {answer().model.providerID}/{answer().model.modelID}
                      </p>
                      <Show when={answer().sources?.length}>
                        <div class="response-lens-sources" aria-label={language.t("responseLens.sources")}>
                          <For each={answer().sources}>
                            {(source) => (
                              <div class="response-lens-source">
                                <span>{source.label}</span>
                                <span class="response-lens-source-status">{source.detail}</span>
                                <Show when={source.truncated}>
                                  <span class="response-lens-source-status">{language.t("responseLens.excerpt")}</span>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </>
                  )}
                </Show>
              </div>
              <ResponseLensSettings />
              <p class="response-lens-hint">{language.t("responseLens.privacy")}</p>
              <div class="response-lens-actions">
                <Button variant="secondary" size="small" disabled={!!request()} onClick={explain}>
                  {language.t("responseLens.retry")}
                </Button>
                <Button variant="ghost" size="small" disabled={!result()} onClick={copy}>
                  {language.t("common.copy")}
                </Button>
              </div>
            </div>
          </Popover>
        )}
      </Show>
    </>
  )
}
