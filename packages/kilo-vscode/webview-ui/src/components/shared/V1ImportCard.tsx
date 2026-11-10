// The Kilo v1 session import, rendered from the host's state in the chat (a card above the session) and in the Settings
// About tab (a section). One component, so both places offer the same steps and show the same progress.
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import type { ToHost, ToWebview, V1ImportAction, V1ImportState } from "../../../../src/protocol"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"

export function createV1Import() {
  const vscode = useVSCode()
  const [state, setState] = createSignal<V1ImportState>({ phase: "none" })
  const stop = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "v1Import.state") setState(message.state)
  })
  onCleanup(stop)
  const send = (type: V1ImportAction["type"]) => vscode.postMessage({ type } satisfies ToHost as never)
  send("v1Import.request")
  return {
    state,
    start: () => send("v1Import.start"),
    later: () => send("v1Import.later"),
    cancel: () => send("v1Import.cancel"),
    dismiss: () => send("v1Import.dismiss"),
  }
}

/** Whether the chat shows the card: an open offer, a running import, or a result the user has not closed yet. */
export function chatShows(state: V1ImportState) {
  if (state.phase === "none") return false
  if (state.phase === "available") return !state.dismissed && !state.imported
  return true
}

export function V1ImportCard(props: { placement: "chat" | "settings"; onOpenHistory?: () => void }) {
  const language = useLanguage()
  const v1 = createV1Import()
  const count = (value: number) => value.toLocaleString()
  const state = v1.state
  const visible = () => props.placement === "settings" || chatShows(state())

  return (
    <Show when={visible()}>
      <section class="v1-import" data-placement={props.placement} data-phase={state().phase} aria-live="polite">
        <Switch>
          <Match when={state().phase === "none"}>
            <p class="v1-import-text">{language.t("v1Import.settings.none")}</p>
          </Match>

          <Match when={state().phase === "available" && state()} keyed>
            {(current) => {
              if (current.phase !== "available") return null
              const again = props.placement === "settings" && current.imported
              return (
                <>
                  {/* Settings shows this under its own section heading. */}
                  <Show when={props.placement === "chat"}>
                    <Header icon="download" title={language.t("v1Import.title")} placement={props.placement} />
                  </Show>
                  <p class="v1-import-text">
                    {again
                      ? language.t("v1Import.settings.imported")
                      : language.t("v1Import.description", { count: count(current.sourceSessions) })}
                  </p>
                  <Show when={!again && current.targetSessions > 0}>
                    <p class="v1-import-note">
                      {language.t("v1Import.replace", { count: count(current.targetSessions) })}
                    </p>
                  </Show>
                  <Show when={current.waiting}>
                    <p class="v1-import-note">{language.t("v1Import.waiting")}</p>
                  </Show>
                  <div class="v1-import-actions">
                    <Button variant="primary" size="small" onClick={v1.start}>
                      {language.t(again ? "v1Import.importAgain" : "v1Import.import")}
                    </Button>
                    <Show when={props.placement === "chat"}>
                      <Button variant="ghost" size="small" onClick={v1.later}>
                        {language.t(current.waiting ? "v1Import.fresh" : "v1Import.later")}
                      </Button>
                    </Show>
                  </div>
                </>
              )
            }}
          </Match>

          <Match when={state().phase === "copying" || state().phase === "converting"}>
            <Header icon="download" title={language.t("v1Import.copying.title")} placement={props.placement} busy />
            <Switch>
              <Match when={state().phase === "copying" && state()} keyed>
                {(current) =>
                  current.phase === "copying" && (
                    <>
                      <p class="v1-import-text">
                        {language.t("v1Import.copying.description", { count: count(current.sourceSessions) })}
                      </p>
                      <Bar />
                    </>
                  )
                }
              </Match>
              <Match when={state().phase === "converting" && state()} keyed>
                {(current) =>
                  current.phase === "converting" && (
                    <>
                      <p class="v1-import-text">
                        {language.t("v1Import.converting", {
                          converted: count(current.converted),
                          total: count(current.total),
                        })}
                      </p>
                      <Bar value={current.total > 0 ? current.converted / current.total : 0} />
                    </>
                  )
                }
              </Match>
            </Switch>
            <div class="v1-import-actions">
              <Button variant="ghost" size="small" onClick={v1.cancel}>
                {language.t("v1Import.cancel")}
              </Button>
            </div>
          </Match>

          <Match when={state().phase === "done" && state()} keyed>
            {(current) =>
              current.phase === "done" && (
                <>
                  <Header icon="circle-check" title={language.t("v1Import.done.title")} placement={props.placement} />
                  <p class="v1-import-text">
                    {language.t("v1Import.done.description", { count: count(current.imported) })}
                  </p>
                  <div class="v1-import-actions">
                    <Show when={props.onOpenHistory}>
                      {(open) => (
                        <Button
                          variant="primary"
                          size="small"
                          onClick={() => {
                            v1.dismiss()
                            open()()
                          }}
                        >
                          {language.t("v1Import.openHistory")}
                        </Button>
                      )}
                    </Show>
                    <Button variant="ghost" size="small" onClick={v1.dismiss}>
                      {language.t("v1Import.dismiss")}
                    </Button>
                  </div>
                </>
              )
            }
          </Match>

          <Match when={state().phase === "failed" && state()} keyed>
            {(current) =>
              current.phase === "failed" && (
                <>
                  <Header
                    icon="circle-ban-sign"
                    title={language.t("v1Import.failed.title")}
                    placement={props.placement}
                  />
                  <p class="v1-import-text">{language.t("v1Import.failed.description")}</p>
                  <p class="v1-import-detail">{current.message}</p>
                  <div class="v1-import-actions">
                    <Button variant="primary" size="small" onClick={v1.start}>
                      {language.t("v1Import.retry")}
                    </Button>
                    <Button variant="ghost" size="small" onClick={v1.dismiss}>
                      {language.t("v1Import.dismiss")}
                    </Button>
                  </div>
                </>
              )
            }
          </Match>
        </Switch>
      </section>
    </Show>
  )
}

function Header(props: { icon: string; title: string; placement: "chat" | "settings"; busy?: boolean }) {
  return (
    <div class="v1-import-header">
      <Show when={props.placement === "chat"}>
        <span class="v1-import-icon" data-busy={props.busy ? "" : undefined}>
          <Icon name={props.icon as never} size="small" />
        </span>
      </Show>
      <h4 class="v1-import-title">{props.title}</h4>
    </div>
  )
}

/** A progress bar: indeterminate while the CLI copies (it reports no progress then), filled while it converts. */
function Bar(props: { value?: number }) {
  return (
    <div
      class="v1-import-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.value === undefined ? undefined : Math.round(props.value * 100)}
      data-indeterminate={props.value === undefined ? "" : undefined}
    >
      <div class="v1-import-bar-fill" style={props.value === undefined ? {} : { width: `${props.value * 100}%` }} />
    </div>
  )
}
