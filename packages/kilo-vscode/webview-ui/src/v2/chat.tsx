// The sidebar: history, profile, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { createEffect, createMemo, createSignal, Match, on, Show, Switch } from "solid-js"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"
import { SessionList } from "./history"
import { TaskHeader } from "../components/chat/TaskHeader"
import ProfileView from "../components/profile/ProfileView"
import { MessageList } from "./messages"
import { PermissionDock } from "./permission"
import { PromptInput } from "./prompt"
import { QuestionDock } from "./question"
import { createProfile } from "./profile"
import { createSelection, Selectors } from "./selectors"
import { SessionDock } from "../components/chat/SessionDockWorking"
import { createWorking } from "./working"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [view, setView] = createSignal<"chat" | "history" | "profile">("chat")
  // Owned here, so a running sign-in survives switching views.
  const profile = createProfile()
  v2.onCommand((name) => {
    if (name === "newSession") {
      setSession(undefined)
      setView("chat")
    }
    if (name === "history") setView("history")
    if (name === "profile") setView("profile")
  })

  const open = (id: string) => {
    setSession(id)
    setView("chat")
  }

  // The open session and its subagents. Subagent permissions and forms carry the subagent's session ID.
  const family = createMemo(() => {
    const id = session()
    if (!id) return []
    return [id, ...v2.data.session.family(id).filter((item) => item !== id)]
  })
  const permissions = () => family().flatMap((id) => v2.data.session.permission.list(id) ?? [])
  const forms = () => family().flatMap((id) => v2.data.session.form.list(id) ?? [])

  // Load again after a reconnect too: createData drops its loaded state while disconnected. Same as the TUI session
  // route (packages/tui/src/routes/session/index.tsx).
  createEffect(
    on([session, v2.connection.status] as const, ([id, status]) => {
      if (!id || status !== "connected") return
      void Promise.all([
        v2.data.session.sync(id, { children: true }),
        v2.data.session.message.sync(id),
        v2.data.session.pending.sync(id),
      ]).catch(v2.report)
    }),
  )
  // A new session is not on the server until its create request settles, so these reads can fail. Events add
  // requests that arrive later.
  createEffect(
    on([family, v2.connection.status] as const, ([ids, status]) => {
      if (status !== "connected") return
      void Promise.allSettled(ids.flatMap((id) => [v2.data.session.permission.sync(id), v2.data.session.form.sync(id)]))
    }),
  )
  // Deletion and a failed create remove the session from createData. Do not send to it again.
  createEffect(
    on(
      () => {
        const id = session()
        return [id, !!id && !!v2.data.session.get(id)] as const
      },
      ([id, known], previous) => {
        if (id && !known && previous?.[0] === id && previous[1]) setSession(undefined)
      },
    ),
  )

  const running = () => {
    const id = session()
    return !!id && v2.data.session.status(id) === "running"
  }

  // A pending permission or question blocks new prompts, as on v1; Stop stays available.
  const blocked = () => permissions().length > 0 || forms().length > 0
  const selection = createSelection(session)
  const working = createWorking(session, blocked)
  let scrollToBottom: (() => void) | undefined

  const send = (text: string) => {
    const id = session() ?? selection.create()
    setSession(id)
    return v2.data.session
      .prompt({ sessionID: id, text, gate: selection.gate(id) })
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
      <Match when={view() === "profile"}>
        <ProfileView profile={profile} />
      </Match>
      <Match when={view() === "chat"}>
        <div class="chat-view">
          <Show when={session()} keyed>
            {(id) => <TaskHeader sessionID={id} />}
          </Show>
          <div class="chat-messages-wrapper">
            <div class="chat-messages">
              <MessageList
                session={session()}
                onSelectSession={open}
                onShowHistory={() => setView("history")}
                onScrollToBottomReady={(fn) => (scrollToBottom = fn)}
              />
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
            <Show when={permissions()[0]} keyed>
              {(request) => <PermissionDock request={request} />}
            </Show>
            <Show when={forms()[0]} keyed>
              {(form) => <QuestionDock form={form} />}
            </Show>
            <SessionDock
              blocked={blocked()}
              status={working.status()}
              submitting={working.submitting()}
              timing={working.timing()}
              text={working.text()}
              retry={working.retry()}
              onCancel={stop}
              onScrollToBottom={() => scrollToBottom?.()}
            />
            <PromptInput
              session={session()}
              running={running()}
              disabled={v2.connection.status() !== "connected" || !!v2.handshake() || blocked()}
              onSend={send}
              onStop={stop}
              selectors={<Selectors selection={selection} blocked={blocked()} />}
            />
          </div>
        </div>
      </Match>
    </Switch>
  )
}
