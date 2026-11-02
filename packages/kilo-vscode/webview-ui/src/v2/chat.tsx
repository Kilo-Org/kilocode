// The sidebar: history, profile, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { ToolChildSessionProvider, type ToolChildSession } from "@kilocode/kilo-ui/tool-child-session"
import { createEffect, createMemo, createSignal, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { getVSCodeAPI } from "../context/vscode"
import { useV2 } from "./client"
import { childTools, createChildSessions } from "./child-session"
import { createGoal, GoalAction, GoalStatus } from "./goal"
import { useDisplaySettings } from "./display-settings"
import { SessionList } from "./history"
import { TaskHeader } from "../components/chat/TaskHeader"
import ProfileView from "../components/profile/ProfileView"
import { MessageList } from "./messages"
import { PermissionDock } from "./permission"
import { PromptInput } from "./prompt"
import { QuestionDock } from "./question"
import { createProfile } from "./profile"
import { createSelection, Selectors } from "./selectors"
import { SessionChanges } from "./session-changes"
import { AutoApproveAction, createAutoApprove } from "./auto-approve"
import { SessionDock } from "../components/chat/SessionDockWorking"
import { createWorking } from "./working"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [view, setView] = createSignal<"chat" | "history" | "profile">("chat")
  const [changes, setChanges] = createSignal(false)
  // Display layouts are Kilo-only config keys, so the host reads them. Ask on connect and after every config change.
  const display = useDisplaySettings()
  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") display.request()
    }),
  )
  onCleanup(v2.data.on("config.updated", () => display.request()))
  // Owned here, so a running sign-in survives switching views.
  const profile = createProfile()
  const startSession = () => {
    setSession(undefined)
    setView("chat")
    setChanges(false)
  }
  v2.onCommand((name) => {
    if (name === "newSession") startSession()
    if (name === "history") setView("history")
    if (name === "profile") setView("profile")
  })

  const open = (id: string) => {
    setSession(id)
    setView("chat")
    setChanges(false)
  }

  // What a tool renderer may ask the host to open. The host owns the editor and the diff surfaces.
  const toolActions: ToolActions = {
    openFile: (filePath, line) =>
      getVSCodeAPI().postMessage({ type: "openToolFile", filePath, line } satisfies ToHost as never),
    openDiff: (diff) => getVSCodeAPI().postMessage({ type: "openDiffVirtual", diff } satisfies ToHost as never),
    openDiffs: (diffs) => getVSCodeAPI().postMessage({ type: "openDiffsVirtual", diffs } satisfies ToHost as never),
    openSession: open,
  }

  // Subagent cards read the child session's tools from the same store as the open session. Load a child's message
  // history when its card first asks for it; later tool events update the loaded messages in place. Leaving a session
  // tree releases every child loaded from it, so a long-lived sidebar does not keep every expanded child transcript.
  const children = createChildSessions({ data: v2.data, report: v2.report })
  const childSessions: ToolChildSession = {
    tools: (sessionID) => childTools(v2.data.session.message.list(sessionID)),
    running: (sessionID) => v2.data.session.status(sessionID) === "running",
    load: children.load,
  }
  let previousSession: string | undefined
  createEffect(
    on(
      session,
      (id) => {
        const previous = previousSession
        previousSession = id
        children.switchTo(id, previous)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      v2.connection.status,
      (status) => {
        if (status === "connected") void children.resync()
      },
      { defer: true },
    ),
  )
  onCleanup(() => children.release(session()))
  createEffect(
    on(session, (id) => {
      if (id) getVSCodeAPI().postMessage({ type: "trackCostSession", sessionID: id } satisfies ToHost as never)
    }),
  )

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

  // A pending permission or question blocks new prompts.
  const blocked = () => permissions().length > 0 || forms().length > 0
  // The prompt selectors block only while a permission owns the prompt, as v1; a pending question does not.
  const selectorsBlocked = () => permissions().length > 0
  // Only a pending permission changes the Send label. A pending question leaves Send in place instead of Stop.
  const questioning = () => permissions().length === 0 && forms().length > 0
  const selection = createSelection(session)
  const autoApprove = createAutoApprove()
  // The host sends the cycle action for the cycleAgentMode/cyclePreviousAgentMode commands, as in main.
  v2.onCommand((name) => {
    if (name === "cycleAgentMode") selection.cycleAgent(1)
    if (name === "cyclePreviousAgentMode") selection.cycleAgent(-1)
  })
  const working = createWorking(session)
  const goal = createGoal(session)
  let scrollToBottom: (() => void) | undefined
  // Counts the in-flight first message too, so the dock reserves the same row on the very first send, as on main.
  // A memo, so the actions row rebuilds only when this flips.
  const hasMessages = createMemo(() => {
    const id = session()
    return !!id && (v2.data.session.message.list(id).length > 0 || working.submitting())
  })
  // main's ChatView actions row. New Session and Changes have v2 counterparts: the worktree and fork actions need
  // the Agent Manager, and the changes view lists this session's files instead of the working tree.
  const actions = (
    <Show when={hasMessages()}>
      <div class="new-task-button-wrapper">
        <div class="session-actions-row">
          <Tooltip value={language.t("sidebar.session.newSession.tooltip")} placement="top">
            <Button
              variant="secondary"
              size="small"
              class="session-new-button"
              onClick={startSession}
              aria-label={language.t("sidebar.session.newSession")}
            >
              {language.t("sidebar.session.newSession")}
            </Button>
          </Tooltip>
          <Button
            variant="secondary"
            size="small"
            aria-pressed={changes()}
            onClick={() => setChanges((open) => !open)}
          >
            {language.t("sidebar.session.changes.title")}
          </Button>
        </div>
      </div>
    </Show>
  )

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

  const sendCommand = (name: string, text: string) => {
    const id = session() ?? selection.create()
    setSession(id)
    // A new session is created in the background; wait for it before the command targets the server directly.
    return Promise.resolve(selection.ready(id))
      .then(() => v2.api.session.command({ sessionID: id, name, text }))
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
            <ToolChildSessionProvider value={childSessions}>
              <div class="chat-messages">
                <Show
                  when={changes() ? session() : undefined}
                  keyed
                  fallback={
                    <MessageList
                      session={session()}
                      actions={toolActions}
                      onSelectSession={open}
                      onShowHistory={() => setView("history")}
                      onScrollToBottomReady={(fn) => (scrollToBottom = fn)}
                    />
                  }
                >
                  {(id) => <SessionChanges sessionID={id} onClose={() => setChanges(false)} />}
                </Show>
              </div>
            </ToolChildSessionProvider>
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
              actions={actions}
              hasActions={hasMessages()}
              status={working.status()}
              submitting={working.submitting()}
              timing={working.timing()}
              text={working.text()}
              retry={working.retry()}
              onCancel={stop}
              onScrollToBottom={() => scrollToBottom?.()}
              trail={<GoalStatus goal={goal()} />}
            />
            <PromptInput
              session={session()}
              running={running()}
              disabled={v2.connection.status() !== "connected" || !!v2.handshake() || blocked()}
              blocked={permissions().length > 0}
              questioning={questioning()}
              onSend={send}
              onStop={stop}
              onCommand={sendCommand}
              selectors={<Selectors selection={selection} blocked={selectorsBlocked()} />}
              actions={
                <>
                  <GoalAction
                    goal={goal()}
                    disabled={v2.connection.status() !== "connected" || !!v2.handshake()}
                    onCommand={(text) => void sendCommand("goal", text)}
                  />
                  <AutoApproveAction enabled={autoApprove.enabled()} onToggle={autoApprove.toggle} />
                </>
              }
            />
          </div>
        </div>
      </Match>
    </Switch>
  )
}
