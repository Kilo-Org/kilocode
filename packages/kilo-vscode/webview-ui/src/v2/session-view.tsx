// One session laid out like main's ChatView: task header, transcript, docks and prompt. The sidebar shows one at a
// time; the Agent Manager shows one per selected tab, each in the store of its directory.
import type { FileDiffInfo, ModelRef } from "@opencode/client"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { ToolChildSessionProvider, type ToolChildSession } from "@kilocode/kilo-ui/tool-child-session"
import { createEffect, createMemo, on, onCleanup, Show, type JSX } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { getVSCodeAPI } from "../context/vscode"
import { TaskHeader } from "../components/chat/TaskHeader"
import { SessionDock } from "../components/chat/SessionDockWorking"
import type { AppendHandler } from "./append-ready"
import { useV2 } from "./client"
import { sessionMissing } from "./scope"
import { childTools, createChildSessions } from "./child-session"
import { MessageList } from "./messages"
import { PermissionDock } from "./permission"
import { PromptInput } from "./prompt"
import { QuestionDock } from "./question"
import { createSelection, Selectors } from "./selectors"
import { AutoApproveAction, createAutoApprove } from "./auto-approve"
import { createWorking } from "./working"

export function SessionView(props: {
  session: string | undefined
  /** Draft identity for the composer when the session is not enough, for example a pending Agent Manager tab. */
  draftKey?: string
  /**
   * Receives the session ID a first prompt creates and the draft key that prompted it, or undefined when the open
   * session is gone.
   */
  onSession: (id: string | undefined, draftKey?: string) => void
  actions: ToolActions
  onShowHistory: () => void
  /** The row above the dock; receives whether the session has messages and the todo element it trails. */
  row?: (hasMessages: boolean, todos: JSX.Element) => JSX.Element
  /** Replaces the transcript with `replacement` while true, for example with the session changes. */
  replace?: boolean
  replacement?: JSX.Element
  /** Replaces the welcome screen of an empty session. */
  empty?: () => JSX.Element
  /** Read-only sessions show the transcript without docks and prompt. */
  readOnly?: boolean
  /** Rendered above the task header, for the sidebar's session tab strip. */
  tabStrip?: JSX.Element
  /** Opens the proposed changes of an edit permission request. */
  onPreviewEdit?: (files: FileDiffInfo[], sessionID: string) => void
  /** Receives the composer append function for review comments, and undefined when that composer unmounts. */
  onAppendReady?: (append: AppendHandler | undefined) => void
  /** Receives each prompt the server admitted, with the model it runs on. */
  onPrompted?: (sessionID: string, text: string, model: ModelRef | undefined) => void
  /** Forks the open session; the header shows the action when set. */
  onForkSession?: (sessionID: string) => void
  /** Forks the session before a user message; each message shows the action when set. */
  onForkMessage?: (sessionID: string, messageID: string) => void
  /** Receives a session the server does not have (deleted, or from another database) instead of an error card. */
  onMissing?: (sessionID: string) => void
  /** Opens the files changed by one turn. */
  onViewTurnChanges?: (sessionID: string, turnID: string) => void
}) {
  const v2 = useV2()
  const session = () => props.session
  // Each session and pending tab has its own composer draft. The keyed mount below discards the previous composer
  // state and the draft store restores the text of the target one.
  const draftKey = () => props.draftKey ?? session() ?? "new"

  // Subagent cards read the child session's tools from the same store as the open session. Load a child's message
  // history when its card first asks for it; later tool events update the loaded messages in place. Leaving a session
  // tree releases every child loaded from it, so a long-lived view does not keep every expanded child transcript.
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
      ]).catch((err: unknown) => {
        // A session created here is known before the server has it; only a session nobody created is missing.
        if (props.onMissing && sessionMissing(err) && !v2.data.session.get(id)) return props.onMissing(id)
        v2.report(err)
      })
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
        if (id && !known && previous?.[0] === id && previous[1]) props.onSession(undefined, id)
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
  const selection = createSelection(session, draftKey)
  const autoApprove = createAutoApprove()
  // The host sends the cycle action for the cycleAgentMode/cyclePreviousAgentMode commands, as in main.
  // A read-only view, for example an Agent Manager subagent, has no composer to cycle.
  if (!props.readOnly)
    v2.onCommand((name) => {
      if (name === "cycleAgentMode") selection.cycleAgent(1)
      if (name === "cyclePreviousAgentMode") selection.cycleAgent(-1)
    })
  const working = createWorking(session)
  let scrollToBottom: (() => void) | undefined
  // Counts the in-flight first message too, so the dock reserves the same row on the very first send, as on main.
  // A memo, so the actions row rebuilds only when this flips.
  const hasMessages = createMemo(() => {
    const id = session()
    return !!id && (v2.data.session.message.list(id).length > 0 || working.submitting())
  })

  const send = (text: string) => {
    const key = draftKey()
    const id = session() ?? selection.create()
    const gate = selection.gate(id)
    // A prompt with a pending switch waits for it, so the attribution has to be read after that switch settles.
    // Without one the selection is current, and it must be read before onSession changes the session identity.
    const model = gate ? undefined : selection.model()
    props.onSession(id, key)
    return v2.data.session
      .prompt({ sessionID: id, text, gate })
      .then(() => {
        props.onPrompted?.(id, text, gate ? selection.attributed(id) : model)
        return true
      })
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
    <div class="chat-view">
      {props.tabStrip}
      <Show when={session()} keyed>
        {(id) => (
          <TaskHeader
            sessionID={id}
            onFork={props.onForkSession ? () => props.onForkSession?.(id) : undefined}
          />
        )}
      </Show>
      <div class="chat-messages-wrapper">
        <ToolChildSessionProvider value={childSessions}>
          <div class="chat-messages">
            <Show
              when={props.replace}
              fallback={
                <MessageList
                  session={session()}
                  actions={props.actions}
                  onSelectSession={(id) => props.actions.openSession?.(id)}
                  onShowHistory={props.onShowHistory}
                  onForkMessage={running() ? undefined : props.onForkMessage}
                  empty={props.empty}
                  onScrollToBottomReady={(fn) => (scrollToBottom = fn)}
                  onViewTurnChanges={props.onViewTurnChanges}
                />
              }
            >
              {props.replacement}
            </Show>
          </div>
        </ToolChildSessionProvider>
      </div>
      <Show when={!props.readOnly}>
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
            {(request) => <PermissionDock request={request} onPreview={props.onPreviewEdit} />}
          </Show>
          <Show when={forms()[0]} keyed>
            {(form) => <QuestionDock form={form} />}
          </Show>
          <SessionDock
            session={session()}
            blocked={blocked()}
            actions={(todos) => props.row?.(hasMessages(), todos)}
            hasActions={hasMessages() && !!props.row}
            status={working.status()}
            submitting={working.submitting()}
            timing={working.timing()}
            text={working.text()}
            retry={working.retry()}
            onCancel={stop}
            onScrollToBottom={() => scrollToBottom?.()}
          />
          <Show when={draftKey()} keyed>
            {(key) => (
              <PromptInput
                draftKey={key}
                session={session()}
                running={running()}
                disabled={v2.connection.status() !== "connected" || !!v2.handshake() || blocked()}
                blocked={permissions().length > 0}
                questioning={questioning()}
                onSend={send}
                onStop={stop}
                onAppendReady={props.onAppendReady}
                selectors={<Selectors selection={selection} blocked={selectorsBlocked()} />}
                actions={<AutoApproveAction enabled={autoApprove.enabled()} onToggle={autoApprove.toggle} />}
              />
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
