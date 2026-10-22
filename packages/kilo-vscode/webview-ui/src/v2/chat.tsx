// The sidebar: history, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { createSignal, Match, Show, Switch } from "solid-js"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"
import { SessionList } from "./history"
import { MessageList } from "./messages"
import { PermissionDock } from "./permission"
import { PromptInput } from "./prompt"
import { QuestionDock } from "./question"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [view, setView] = createSignal<"chat" | "history">("chat")
  v2.onCommand((name) => {
    if (name === "newSession") {
      setSession(undefined)
      setView("chat")
    }
    if (name === "history") setView("history")
  })

  const open = (id: string) => {
    setSession(id)
    setView("chat")
    void Promise.all([
      v2.data.session.sync(id),
      v2.data.session.message.sync(id),
      v2.data.session.pending.sync(id),
      v2.data.session.permission.sync(id),
      v2.data.session.form.sync(id),
    ]).catch(v2.report)
  }

  const running = () => {
    const id = session()
    return !!id && v2.data.session.status(id) === "running"
  }

  // A pending permission or question blocks new prompts, as on v1; Stop stays available.
  const blocked = () => {
    const id = session()
    return !!id && (!!v2.data.session.permission.list(id)?.length || !!v2.data.session.form.list(id)?.length)
  }

  const send = (text: string) => {
    const id = session() ?? v2.data.session.create({}).id
    setSession(id)
    return v2.data.session
      .prompt({ sessionID: id, text })
      .then(() => true)
      .catch((err: unknown) => {
        v2.report(err)
        return false
      })
  }

  const stop = () => {
    const id = session()
    if (id) void v2.api.session.interrupt({ sessionID: id }).catch(v2.report)
  }

  return (
    <Switch>
      <Match when={view() === "history"}>
        <div class="history-view">
          <div class="history-view-header">
            <Button variant="ghost" size="small" icon="arrow-left" onClick={() => setView("chat")}>
              {language.t("common.goBack")}
            </Button>
          </div>
          <div class="history-view-content">
            <SessionList onOpen={open} />
          </div>
        </div>
      </Match>
      <Match when={view() === "chat"}>
        <div class="chat-view">
          <div class="chat-messages-wrapper">
            <div class="chat-messages">
              <MessageList session={session()} onSelectSession={open} onShowHistory={() => setView("history")} />
            </div>
          </div>
          <div class="chat-input">
            <Show when={v2.handshake() || v2.error()}>
              <div class="error-card" role="alert" data-component="v2-error">
                <span>{v2.handshake() || v2.error()}</span>
                <button class="error-card-dismiss" onClick={() => v2.setError("")}>
                  x
                </button>
              </div>
            </Show>
            <Show when={session()}>
              {(id) => (
                <>
                  <Show when={v2.data.session.permission.list(id())?.[0]} keyed>
                    {(request) => <PermissionDock request={request} />}
                  </Show>
                  <Show when={v2.data.session.form.list(id())?.[0]} keyed>
                    {(form) => <QuestionDock form={form} />}
                  </Show>
                </>
              )}
            </Show>
            <PromptInput
              session={session()}
              running={running()}
              disabled={v2.connection.status() !== "connected" || !!v2.handshake() || blocked()}
              onSend={send}
              onStop={stop}
            />
          </div>
        </div>
      </Match>
    </Switch>
  )
}
