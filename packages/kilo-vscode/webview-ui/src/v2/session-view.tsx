// One session laid out like main's ChatView: task header, transcript, docks and prompt. The sidebar shows one at a
// time; the Agent Manager shows one per selected tab, each in the store of its directory.
import type { FileDiffInfo, JsonValue, ModelRef } from "@opencode/client"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { ToolChildSessionProvider, type ToolChildSession } from "@kilocode/kilo-ui/tool-child-session"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js"
import type { PromptAttachment, ToHost } from "../../../src/protocol"
import type { MentionFile } from "../hooks/context-mention-utils"
import type { GitChangesTarget } from "../hooks/useGitChangesContext"
import type { WorktreeReference } from "../utils/prompt-mention-drop"
import { parseCommandModel } from "../components/settings/agent-behaviour/command-model"
import { useLanguage } from "../context/language"
import { focusPrompt } from "../utils/tab-navigation"
import { useModelPreferences } from "../context/model-preferences"
import { useWorkStyleOptional } from "../context/work-style"
import { getVSCodeAPI } from "../context/vscode"
import { movePromptHistory } from "../hooks/usePromptHistory"
import { kiloSettings } from "./kilo-settings"
import { TaskHeader } from "../components/chat/TaskHeader"
import { SessionDock } from "../components/chat/SessionDockWorking"
import type { AppendHandler, ReferenceHandler, ReviewAppendHandler } from "./append-ready"
import type { ComposerHandle } from "./composer"
import { promptFiles } from "./prompt-attachments"
import { useV2 } from "./client"
import { useDisplaySettings } from "./display-settings"
import { ErrorBanner } from "./error-banner"
import { sessionMissing } from "./scope"
import { childTools, createChildSessions } from "./child-session"
import { MessageList } from "./messages"
import { PermissionDock } from "./permission"
import { PromptInput } from "./prompt"
import { createSelection, Selectors } from "./selectors"
import type { ManagerContext } from "./shortcut-hint"
import { settledLoader, startingLoader } from "./session-loading"
import { createAutoApprove } from "./auto-approve"
import { createSandbox } from "./sandbox"
import { createBackgroundJobs } from "./background-jobs"
import { createWorking } from "./working"
import { createPending } from "./pending"
import { promptInterrupt, steerInterrupts, type SendMode } from "./pending-actions"
import { mergeCatalog, type SlashEntry } from "./slash"
import { reviewScopes, slashActions, type SlashHandlers } from "./slash-actions"
import { createSlashCatalog } from "./slash-catalog"
import { dispatchSlash } from "./slash-dispatch"
import { TranscriptSearchProvider } from "./transcript-search"

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
  /** True for a session in an Agent Manager worktree, which can run /review worktree. */
  worktree?: boolean
  /** Opens a new session draft; the /new slash action is listed only when set. */
  onNewSession?: () => void
  /**
   * The row above the dock; receives whether the session has messages, the todo element it trails and the background
   * agent stack it leads.
   */
  row?: (hasMessages: boolean, todos: JSX.Element, agents: JSX.Element) => JSX.Element
  /** Shows the row before the first message too. */
  rowWhenEmpty?: boolean
  /** Replaces the welcome screen of an empty session. */
  empty?: () => JSX.Element
  /** Read-only sessions show the transcript without docks and prompt. */
  readOnly?: boolean
  /** Whether the Command Palette search toggle targets this view; the Agent Manager's sub-agent inspector turns it off. */
  searchCommand?: boolean
  /** Rendered above the task header, for the sidebar's session tab strip. */
  tabStrip?: JSX.Element
  /** Opens the proposed changes of an edit permission request. */
  onPreviewEdit?: (files: FileDiffInfo[], sessionID: string) => void
  /** Receives the composer append function for review comments, and undefined when that composer unmounts. */
  onAppendReady?: (append: AppendHandler | undefined) => void
  /** Receives the composer review-comment function, and undefined when that composer unmounts. */
  onReviewAppendReady?: (append: ReviewAppendHandler | undefined) => void
  /** Receives the composer function that adds an Integrated Browser element reference. */
  onReferenceReady?: (add: ReferenceHandler | undefined) => void
  /** Receives the composer for editor and terminal context actions, and undefined when that composer unmounts. */
  onComposerReady?: (composer: ComposerHandle | undefined) => void
  /** Receives each prompt the server admitted, with the model it runs on. */
  onPrompted?: (sessionID: string, text: string, model: ModelRef | undefined) => void
  /** Forks the session before a user message; each message shows the action when set. */
  onForkMessage?: (sessionID: string, messageID: string) => void
  /** Receives a session the server does not have (deleted, or from another database) instead of an error card. */
  onMissing?: (sessionID: string) => void
  /** Opens the files changed by one turn. */
  onViewTurnChanges?: (sessionID: string, turnID: string) => void
  /** Agent Manager worktrees the composer's `@` menu can reference. */
  worktrees?: Accessor<WorktreeReference[]>
  /** Whether the composer's `@` menu offers Git changes. */
  git?: () => boolean
  /** What `@git-changes` diffs in this view. */
  gitTarget?: () => GitChangesTarget | undefined
  /** The Agent Manager worktree, or `local`, whose terminal `@terminal` reads. */
  terminalContext?: () => string | undefined
  /** Reads the focused Agent Manager terminal for `@terminal`. */
  resolveEmbeddedTerminal?: (context?: string) => Promise<string | undefined>
  /** Another session tab is open, so the prompt suggests switching tabs. */
  tabs?: boolean
  /** Agent Manager state for the prompt shortcut hint; the sidebar passes nothing. */
  manager?: () => ManagerContext | undefined
  /** Whether a composer mounted for a switched draft takes focus, as v1's draft-change effect did. */
  focusOnDraftChange?: () => boolean
  /** Receives each focus and blur of the composer, so the Agent Manager restores the prompt on return. */
  onFocusChange?: (focused: boolean) => void
}) {
  const v2 = useV2()
  const language = useLanguage()
  const session = () => props.session
  const work = useWorkStyleOptional()
  // Display layouts and the reasoning mode are Kilo-only config keys, so the host reads them. Every surface that
  // renders a transcript asks on connect and after each config change.
  const display = useDisplaySettings()
  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") display.request()
    }),
  )
  onCleanup(v2.data.on("config.updated", () => display.request()))
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

  // The session-start loader lasts until the first transcript page lands. createData reports loading only for pages it
  // adds, and an already loaded transcript must stay instant, so the view that starts the first request tracks it. A
  // newer request owns the loader, so the settle of a superseded one cannot clear it.
  const [starting, setStarting] = createSignal<string>()
  let attempt = 0
  // Load again after a reconnect too: createData drops its loaded state while disconnected. Same as the TUI session
  // route (packages/tui/src/routes/session/index.tsx).
  createEffect(
    on([session, v2.connection.status] as const, ([id, status]) => {
      if (!id || status !== "connected") return
      const run = ++attempt
      const loaded = v2.data.session.message.startLoaded(id)
      const messages = v2.data.session.message.sync(id)
      setStarting((value) => startingLoader(value, { session: id, loaded }))
      const settle = () => setStarting((value) => settledLoader(value, { session: id, run, attempt }))
      void messages.then(settle, settle)
      void Promise.all([
        v2.data.session.sync(id, { children: true }),
        messages,
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

  // Questions do not block the prompt, as in v1: a pending question is dismissed when the user sends instead.
  // Only a permission blocks sending, and the composer stays writable so typing remains possible.
  const blocked = () => permissions().length > 0
  const dockBlocked = () => blocked() || forms().length > 0
  // The prompt selectors block only while a permission owns the prompt, as v1; a pending question does not.
  const selectorsBlocked = () => permissions().length > 0
  // Only a pending permission changes the Send label. A pending question leaves Send in place instead of Stop.
  const questioning = () => !blocked() && forms().length > 0
  const selection = createSelection(session, draftKey)
  const preferences = useModelPreferences()
  const autoApprove = createAutoApprove()
  const sandbox = createSandbox({ session, gate: selection.created })
  const sandboxControl = {
    visible: sandbox.visible,
    ready: sandbox.ready,
    enabled: sandbox.enabled,
    available: sandbox.available,
    reason: sandbox.reason,
    network: sandbox.network,
    disabled: sandbox.disabled,
    onToggle: sandbox.toggle,
  }
  // The host sends the cycle action for the cycleAgentMode/cyclePreviousAgentMode commands, as in main.
  // A read-only view, for example an Agent Manager subagent, has no composer to cycle.
  if (!props.readOnly)
    v2.onCommand((name) => {
      if (name === "cycleAgentMode") selection.cycleAgent(1)
      if (name === "cyclePreviousAgentMode") selection.cycleAgent(-1)
    })
  const working = createWorking(session)
  // Subagent jobs feed the dock's agent stack and the stop and "continue in background" actions of subagent cards. A
  // read-only view has no dock and offers neither action.
  const jobs = createBackgroundJobs({ session })
  const actions = createMemo<ToolActions>(() =>
    props.readOnly
      ? props.actions
      : { ...props.actions, stopSession: jobs.cancel, backgroundSession: jobs.promote },
  )
  let scrollToBottom: (() => void) | undefined
  // The open composer's append function. Edit takes a pending prompt back into it.
  let composer: AppendHandler | undefined
  const pending = createPending({
    session,
    readOnly: () => !!props.readOnly,
    running,
    edit: (text) => composer?.(text, false),
  })
  // Counts the in-flight first message too, so the dock reserves the same row on the very first send, as on main.
  // A memo, so the actions row rebuilds only when this flips.
  const hasMessages = createMemo(() => {
    const id = session()
    return !!id && (v2.data.session.message.list(id).length > 0 || working.submitting())
  })

  // A prompt and a slash command start the same way: a draft creates its session, the tab settles on it, a pending
  // question is dismissed, and a send that should stop the running model call stops it.
  const begin = async (mode: SendMode) => {
    const key = draftKey()
    // The first prompt is a task start too; skip an unset work style so the picker does not return later.
    work?.skip()
    // A created session is seeded with the resolved sandbox default before the first prompt.
    const seed = session() ? undefined : await sandbox.metadata()
    const id = session() ?? selection.create(seed)
    const gate = selection.gate(id)
    // The prompt runs on what the composer shows: its draft, which the send commits, or the session's own model.
    // Read both before onSession changes the session identity.
    const model = selection.model()
    const draft = selection.draft(id)
    // A pending question is dismissed when the user sends instead.
    const questions = forms()
    props.onSession(id, key)
    // The first prompt settles the draft tab into a session key. Carry the history a late append still targets.
    const scopedHistory = kiloSettings()["experimental.conversationPromptHistory"] === true
    if (key !== id && scopedHistory) movePromptHistory(key, id)
    for (const form of questions) {
      void v2.data.session.form.cancel({ sessionID: form.sessionID, formID: form.id }).catch(() => undefined)
    }
    // A steer reaches a thinking or writing model only by stopping that model call; a running tool finishes first.
    // Stop before admitting: if the prompt were admitted first, the run could start answering it at a step boundary
    // and the stop would then end that answer. The partial response stays in the transcript and the run continues
    // with the prompt. A failed stop still sends the prompt as a steer. Sending a prompt never cancels a running
    // compaction either way: `now` still stops the model call and running tools, but the checkpoint finishes first
    // and the prompt follows it. Only Stop itself, and Escape with it, may cancel a compaction.
    const waiting = new Set(v2.data.session.pending.list(id).map((item) => item.id))
    const interrupt =
      running() && (mode === "now" || (mode === "steer" && steerInterrupts(v2.data.session.message.list(id), waiting)))
    if (interrupt)
      await v2.api.session.interrupt(promptInterrupt(id)).catch((err: unknown) => v2.report(err))
    return { id, gate, model, draft }
  }

  // The prompt is admitted on the server; the Most used group counts sent prompts per model, as v1.
  const prompted = (id: string, text: string, used: ModelRef | undefined) => {
    if (used) preferences?.recordUsage(used.providerID, used.id)
    props.onPrompted?.(id, text, used)
    return true
  }

  const send = async (
    text: string,
    mode: SendMode = "steer",
    input?: { items?: PromptAttachment[]; files?: MentionFile[]; metadata?: { [key: string]: JsonValue } },
  ) => {
    const { id, gate, model, draft } = await begin(mode)
    const files = promptFiles(input?.items ?? [], input?.files ?? [])
    return v2.data.session
      .prompt({
        sessionID: id,
        text,
        // A pending switch, such as an agent change, fails the prompt instead of running under another agent.
        gate,
        // The draft commits after earlier prompts are admitted, as the TUI; a failed switch fails the prompt.
        prepare: () => selection.commit(id, draft),
        metadata: input?.metadata,
        files,
        delivery: mode === "queue" ? "queue" : "steer",
      })
      .then(() => prompted(id, text, model))
      .catch((err: unknown) => {
        v2.report(err)
        return false
      })
  }

  // Server commands and skills of the slash menu, from the cache of this location.
  const catalog = createSlashCatalog({
    command: v2.data.location.command,
    skill: v2.data.location.skill,
    on: v2.data.on,
    report: v2.report,
  })
  onCleanup(catalog.dispose)
  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected" && !props.readOnly) void catalog.load()
    }),
  )
  // The selectors listen for these events, so a slash action opens the same picker as a click.
  const picker = (name: string) => () => window.dispatchEvent(new CustomEvent(name))
  // Compaction runs on the composer's selection, as the TUI: an uncommitted draft switches the session first.
  const compact = (id: string) =>
    void v2.data.session.compact({ sessionID: id, model: selection.draft(id) }).catch(v2.report)
  const handlers = (): SlashHandlers => {
    const id = session()
    const start = props.onNewSession
    return {
      // The new tab remounts the composer that had focus, so the focus moves to the new composer after it mounts.
      new: start
        ? () => {
            start()
            requestAnimationFrame(focusPrompt)
          }
        : undefined,
      sessions: props.onShowHistory,
      models: picker("openModelPicker"),
      agents: selection.agents().length > 1 ? picker("openModePicker") : undefined,
      variant: selection.variants().length > 0 ? picker("openVariantPicker") : undefined,
      compact: id ? () => compact(id) : undefined,
      caffeinate: () =>
        getVSCodeAPI().postMessage({ type: "agentManager.toggleCaffeination" } satisfies ToHost as never),
      help: () => v2.open("https://kilo.ai/docs"),
      marketplace: () => getVSCodeAPI().postMessage({ type: "openMarketplace" } satisfies ToHost as never),
      settings: () => getVSCodeAPI().postMessage({ type: "openSettingsTab" } satisfies ToHost as never),
      reload: () => void v2.api.location.reload().catch(v2.report),
    }
  }
  const slashEntries = createMemo(() =>
    mergeCatalog({
      actions: slashActions(handlers(), language.t),
      // Goal mode needs its own composer state and banner, which this client does not have yet.
      commands: catalog.commands().filter((command) => command.name !== "goal"),
      nested: reviewScopes(catalog.commands(), props.worktree === true),
      skills: catalog.skills(),
    }),
  )

  const runSlash = async (
    entry: SlashEntry,
    args: string,
    mode: SendMode,
    items: PromptAttachment[],
    mentions: MentionFile[] = [],
  ) => {
    const { id, gate, model } = await begin(mode)
    const text = args ? `/${entry.name} ${args}` : `/${entry.name}`
    // A command with its own model runs on that model, which the server switches the session to.
    const own = entry.kind === "command" ? parseCommandModel(entry.command.model) : undefined
    return dispatchSlash(
      {
        entry,
        args,
        files: promptFiles(items, mentions),
        delivery: mode === "queue" ? "queue" : "steer",
      },
      {
        session: async () => {
          await selection.created(id)
          await gate
          return id
        },
        selected: (sessionID) => selection.selected(sessionID),
        switchModel: (input) => v2.api.session.switchModel(input),
        command: (input) => v2.api.session.command(input),
        prompt: (input) => v2.data.session.prompt(input),
      },
    )
      .then(() => prompted(id, text, own ? { providerID: own.providerID, id: own.modelID } : model))
      .catch((err: unknown) => {
        v2.report(err)
        return false
      })
  }

  const stop = () => {
    const id = session()
    if (id) void v2.api.session.interrupt({ sessionID: id }).catch(v2.report)
  }

  // Escape interrupts the running turn, as v1's ChatView did. A question dock, popover or selector that handles
  // Escape first consumes the event, so this only fires for a press nothing else used. A read-only view has no
  // composer, so it also has nothing to interrupt.
  onMount(() => {
    if (props.readOnly) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return
      if (!running() && !working.submitting()) return
      event.preventDefault()
      stop()
    }
    document.addEventListener("keydown", handler)
    onCleanup(() => document.removeEventListener("keydown", handler))
  })

  return (
    <TranscriptSearchProvider>
      <div class="chat-view">
        {props.tabStrip}
        <Show when={session()} keyed>
          {(id) => (
            <TaskHeader
              sessionID={id}
              readonly={props.readOnly}
              searchCommand={props.searchCommand}
              onCompact={() => compact(id)}
            />
          )}
        </Show>
        <div class="chat-messages-wrapper">
          <ToolChildSessionProvider value={childSessions}>
            <div class="chat-messages">
              <MessageList
                session={session()}
                starting={starting()}
                actions={actions()}
                selection={selection}
                onSelectSession={(id) => props.actions.openSession?.(id)}
                onShowHistory={props.onShowHistory}
                onForkMessage={running() ? undefined : props.onForkMessage}
                empty={props.empty}
                onScrollToBottomReady={(fn) => (scrollToBottom = fn)}
                onViewTurnChanges={props.onViewTurnChanges}
                pending={pending}
                question={() => (props.readOnly ? undefined : forms()[0])}
              />
            </div>
          </ToolChildSessionProvider>
        </div>
        <Show when={!props.readOnly}>
          <div class="chat-input">
            <Show when={v2.handshake() ?? v2.failure()}>
              {(failure) => (
                <ErrorBanner failure={failure()} onDismiss={v2.handshake() ? undefined : v2.clearError} />
              )}
            </Show>
            <Show when={permissions()[0]} keyed>
              {(request) => <PermissionDock request={request} onPreview={props.onPreviewEdit} />}
            </Show>
            <SessionDock
              session={session()}
              jobs={jobs}
              onOpenSession={(id, title) =>
                props.actions.openSubagent ? props.actions.openSubagent(id, title) : props.actions.openSession?.(id)
              }
              blocked={dockBlocked()}
              actions={(todos, agents) => props.row?.(hasMessages(), todos, agents)}
              hasActions={!!props.row && (hasMessages() || !!props.rowWhenEmpty)}
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
                  disabled={v2.connection.status() !== "connected" || !!v2.handshake()}
                  blocked={blocked()}
                  questioning={questioning()}
                  onSend={send}
                  onStop={stop}
                  onAppendReady={(append) => {
                    composer = append
                    props.onAppendReady?.(append)
                  }}
                  onReviewAppendReady={props.onReviewAppendReady}
                  onReferenceReady={props.onReferenceReady}
                  onComposerReady={props.onComposerReady}
                  slash={{ entries: slashEntries, run: runSlash }}
                  tabs={props.tabs}
                  manager={props.manager}
                  focusOnDraftChange={props.focusOnDraftChange}
                  onFocusChange={props.onFocusChange}
                  selectors={<Selectors selection={selection} blocked={selectorsBlocked()} />}
                  autoApprove={{ enabled: autoApprove.enabled(), onToggle: autoApprove.toggle }}
                  sandbox={sandboxControl}
                  worktrees={props.worktrees}
                  git={props.git}
                  gitTarget={props.gitTarget}
                  terminalContext={props.terminalContext}
                  resolveEmbeddedTerminal={props.resolveEmbeddedTerminal}
                  onOpenFile={(path) => props.actions.openFile?.(path, undefined, undefined, session())}
                />
              )}
            </Show>
          </div>
        </Show>
      </div>
    </TranscriptSearchProvider>
  )
}
