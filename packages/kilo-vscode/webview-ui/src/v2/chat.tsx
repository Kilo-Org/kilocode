// The sidebar: history or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import type { GitChangesStats, ToHost, ToWebview } from "../../../src/protocol"
import { injectedMetadata } from "../../../src/shared/injected-prompt"
import { useLanguage } from "../context/language"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
import { useWorkStyle } from "../context/work-style"
import type { ReferenceHandler } from "./append-ready"
import { useV2 } from "./client"
import { SessionList } from "./history"
import { recordForkHandoff } from "../../../src/agent-manager/fork-handoff"
import { createLocalTabs } from "./local-tabs"
import { SessionTabStrip } from "./session-tabs"
import { SessionView } from "./session-view"
import { SessionActionsRow } from "./session-actions-row"
import { createWorktreeTransfer } from "./worktree-transfer"
import { chunkPaths } from "./validate-paths"
import { createReviewAppendQueue } from "./review-queue"
import { createComposerQueue } from "./composer"
import { createPlanOpener } from "./open-plan"
import { openSubagent } from "./open-subagent"
import { showTabStrip } from "../utils/local-tabs"
import { focusPrompt } from "../utils/tab-navigation"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const work = useWorkStyle()
  // The sidebar restores its local tabs. An editor tab is bound to the session the host opened it on, and writes the
  // session it shows into its own state so the host serializer can restore it.
  const surface = (window as unknown as { KILO_SURFACE?: string }).KILO_SURFACE === "editor" ? "editor" : "sidebar"
  const initial =
    surface === "editor"
      ? ((window as unknown as { KILO_SESSION_ID?: string | null }).KILO_SESSION_ID ?? undefined)
      : undefined
  const tabs = createLocalTabs({ session: initial })
  const [view, setView] = createSignal<"chat" | "history">("chat")
  // Comments can arrive while the chat composer is unmounted (History), so hold them until it returns.
  const reviewQueue = createReviewAppendQueue()
  // Editor and terminal context actions target the chat composer too, and wait the same way while it is unmounted.
  const composerQueue = createComposerQueue()
  const [changes, setChanges] = createSignal(false)
  const vscode = useVSCode()
  // The working tree counts the host pushes. The button reads the current value without polling.
  const [stats, setStats] = createSignal<GitChangesStats>()
  const stopStats = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "gitChangesStats") setStats(message.stats)
  })
  onCleanup(stopStats)
  vscode.postMessage({ type: "requestGitChangesStats" } satisfies ToHost as never)
  // The Agent Manager owns worktree creation and movement, so the sidebar asks it for the branch and reports its steps.
  const transfer = createWorktreeTransfer()
  // A turn's changes belong to its tab, so switching tabs returns to that tab's chat.
  createEffect(on(tabs.active, () => setChanges(false), { defer: true }))
  // The history search asks for autofocus, which a browser applies only on page load, so focus it on each open.
  let history: HTMLDivElement | undefined
  createEffect(
    on(view, (value) => {
      if (value !== "history") return
      requestAnimationFrame(() => history?.querySelector<HTMLInputElement>('[data-slot="list-search"] input')?.focus())
    }),
  )
  const startSession = () => {
    work.skip()
    tabs.add()
    setView("chat")
  }
  const open = (id: string) => {
    tabs.open(id)
    setView("chat")
    // The history row that had focus is gone, so the opened session's composer takes it.
    requestAnimationFrame(focusPrompt)
  }
  // The plan handoff creates a new session on the server and asks the client to show it. The TUI and the
  // VS Code sidebar both consume this event, so the new Code session opens in the active view.
  onCleanup(
    v2.data.on("tui.session.select", (event) => {
      if (event.location && event.location.directory !== v2.directory) return
      open(event.data.sessionID)
    }),
  )
  const step = (offset: -1 | 1) => {
    if (!document.hasFocus() || view() !== "chat") return
    const before = tabs.active()
    tabs.step(offset)
    if (tabs.active() !== before) requestAnimationFrame(focusPrompt)
  }
  v2.onCommand((name) => {
    if (name === "newSession") startSession()
    if (name === "history") setView("history")
    if (name === "focusSearch") {
      setView("chat")
      // A search request only reaches the session header while the chat is the
      // visible view; it mounts after the switch, so dispatch on the next frame.
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusTranscriptSearch")))
    }
    if (name === "showOpenTabs") {
      setView("chat")
      window.dispatchEvent(new Event("showOpenTabs"))
    }
    if (name === "tabPrevious") step(-1)
    if (name === "tabNext") step(1)
    if (name !== "focusPrompt") return
    setView("chat")
    // The composer mounts after the view switch, so focus it on the next frame.
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { force: true, restore: true } })),
    )
  })

  // One fork per session at a time, so a double click does not create two forks.
  const forking = new Set<string>()
  const forkSession = (id: string, messageId?: string) => {
    if (forking.has(id)) return
    forking.add(id)
    void v2.api.session
      .fork({ sessionID: id, ...(messageId ? { before: messageId } : {}) })
      .then(async (info) => {
        await recordForkHandoff({ client: v2.api, sessionId: info.id, directory: v2.directory }).catch(v2.report)
        v2.data.session.remember(info)
        tabs.openAfter(id, info.id)
      })
      .catch(v2.report)
      .finally(() => forking.delete(id))
  }

  const session = () => tabs.session()
  const settled = (id: string | undefined, draftKey?: string) => {
    if (!id) return tabs.close(draftKey ?? tabs.active())
    tabs.settled(draftKey ?? tabs.active(), id)
  }

  // An element picked in the Integrated Browser arrives for this view and joins the composer's reference list.
  // The editor-tab browser and the Agent Manager share one broker; report which session this sidebar shows.
  createEffect(() => {
    const id = session()
    vscode.postMessage({ type: "sidebar.session", sessionId: id })
  })
  // An editor tab restores from its own webview state, not from the sidebar's local tabs.
  createEffect(() => {
    if (surface !== "editor") return
    const id = session()
    vscode.setState({
      ...(vscode.getState<Record<string, unknown>>() ?? {}),
      sessionID: id ?? null,
      directory: v2.directory,
    })
  })
  let reference: ReferenceHandler | undefined
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "browserReference") return
      // A tab outlives a session switch, so a reference can arrive for a session the composer no longer shows.
      if (message.reference.sessionId !== session()) return
      reference?.(message.reference)
    }),
  )
  // File candidates are validated by the host, which owns filesystem access and the worktree boundary.
  const fileChecks = new Map<string, { resolve: (existing: string[]) => void; reject: (error: Error) => void }>()
  const fileCheckPrefix = createUniqueId()
  let fileCheckCount = 0
  onMount(() => {
    const message = vscode.onMessage((item) => {
      if (item.type === "validateFilesResult") {
        const pending = fileChecks.get(item.id)
        if (!pending) return
        fileChecks.delete(item.id)
        pending.resolve(item.existing)
        return
      }
      if (item.type === "appendContext") {
        setView("chat")
        composerQueue.push({ type: "attach", items: item.items })
        return
      }
      if (item.type === "openSession") {
        open(item.sessionID)
        return
      }
      if (item.type === "startPrompt") {
        setView("chat")
        composerQueue.push({
          type: "submit",
          text: item.text,
          items: item.items ?? [],
          metadata: item.injectedTitle ? injectedMetadata(item.injectedTitle) : undefined,
        })
        return
      }
      if (item.type !== "appendReviewComments") return
      reviewQueue.push(item.comments, item.autoSend)
    })
    onCleanup(() => {
      message()
      // Reject on unmount so the shared cache keeps these paths unknown instead of caching them as missing.
      for (const pending of fileChecks.values()) pending.reject(new Error("validateFiles cancelled"))
      fileChecks.clear()
    })
  })
  // Keep each host request small so one frame with many candidates stays responsive; every path is still checked.
  const FILE_CHECK_CHUNK = 64
  const validateFiles = (sessionID: string, paths: string[]) => {
    const chunks = chunkPaths(paths, FILE_CHECK_CHUNK)
    return Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<string[]>((resolve, reject) => {
            const id = `${fileCheckPrefix}-${++fileCheckCount}`
            fileChecks.set(id, { resolve, reject })
            getVSCodeAPI().postMessage({ type: "validateFiles", id, sessionID, paths: chunk } satisfies ToHost as never)
            setTimeout(() => {
              const pending = fileChecks.get(id)
              if (!pending) return
              fileChecks.delete(id)
              pending.reject(new Error("validateFiles timed out"))
            }, 3000)
          }),
      ),
    ).then((results) => results.flat())
  }
  // The Changes tab opens the whole working tree of the session, as v1's Changes button did.
  const openChanges = () =>
    vscode.postMessage({ type: "openChanges", sessionID: session() } satisfies ToHost as never)

  // A turn opens the Changes tab in turn scope: `turnID` is the user message that started it.
  const openTurnChanges = (sessionID: string, turnID: string) =>
    vscode.postMessage({ type: "openChanges", sessionID, turnID } satisfies ToHost as never)

  // What a tool renderer may ask the host to open. The host owns the editor and the diff surfaces.
  const openToolFile = (filePath: string, line?: number, column?: number, sessionID?: string) =>
    getVSCodeAPI().postMessage({
      type: "openToolFile",
      filePath,
      line,
      column,
      sessionID: sessionID ?? session(),
    } satisfies ToHost as never)
  const toolActions: ToolActions = {
    openFile: openToolFile,
    validateFiles,
    openDiff: (diff) => getVSCodeAPI().postMessage({ type: "openDiffVirtual", diff } satisfies ToHost as never),
    openDiffs: (diffs) => getVSCodeAPI().postMessage({ type: "openDiffsVirtual", diffs } satisfies ToHost as never),
    openSession: open,
    // A subagent opens in its own read-only editor tab, so the sidebar keeps the parent session.
    subagentTarget: "tab",
    openSubagent: (sessionID, title) =>
      openSubagent({
        sessionID,
        title,
        parentSessionID: session(),
        surface: "tab",
        post: (message) => getVSCodeAPI().postMessage(message as never),
      }),
  }

  // A completed open_plan call opens its plan file once its session is active. The connection carries events for
  // every directory, so another directory's sessions are ignored.
  const planOpener = createPlanOpener(
    () => session(),
    (plan) => openToolFile(plan.path, undefined, undefined, plan.sessionID),
  )
  const inScope = (event: { location?: { directory: string } }) =>
    !event.location || event.location.directory === v2.directory
  onCleanup(
    v2.data.on("session.tool.input.started", (event) => {
      if (!inScope(event)) return
      planOpener.started(event.data.sessionID, event.data.id, event.data.name)
    }),
  )
  onCleanup(
    v2.data.on("session.tool.success", (event) => {
      if (!inScope(event)) return
      planOpener.completed(event.data.sessionID, event.data.id, event.data.metadata)
    }),
  )
  onCleanup(
    v2.data.on("session.tool.failed", (event) => {
      if (!inScope(event)) return
      planOpener.failed(event.data.sessionID, event.data.id)
    }),
  )
  onCleanup(
    v2.data.on("session.deleted", (event) => {
      if (inScope(event)) planOpener.forget(event.data.sessionID)
    }),
  )
  createEffect(() => planOpener.flush(session()))

  const startWorktree = () => vscode.postMessage({ type: "agentManager.createWorktree" } satisfies ToHost as never)
  const startWorktreeFromBranch = (branch: string) =>
    vscode.postMessage({ type: "agentManager.createWorktree", baseBranch: branch } satisfies ToHost as never)
  const showAdvancedWorktree = () => vscode.postMessage({ type: "openAdvancedWorktree" } satisfies ToHost as never)
  const moveToWorktree = () => {
    const id = session()
    if (id) transfer.move(id)
  }

  // The session actions row: the agent stack, New Session, the worktree actions, Changes and the todo chip. The
  // worktree actions need a git repository, so they show only when the Agent Manager reports a branch.
  const row = (hasMessages: boolean, todos: JSX.Element, agents: JSX.Element) => (
    <SessionActionsRow
      hasMessages={hasMessages}
      branch={transfer.branch()}
      onNewSession={startSession}
      onNewWorktree={startWorktree}
      onNewWorktreeFromBranch={startWorktreeFromBranch}
      onConfigureWorktree={showAdvancedWorktree}
      onMoveToWorktree={session() ? moveToWorktree : undefined}
      moving={transfer.transferring()}
      moveDetail={transfer.detail()}
      stats={stats()}
      onShowChanges={openChanges}
      todos={todos}
      agents={agents}
    />
  )

  return (
    <Switch>
      <Match when={view() === "history"}>
        <div class="history-view">
          <div class="history-view-header">
            <Button variant="ghost" size="small" icon="arrow-left" onClick={() => setView("chat")}>
              {language.t("common.goBack")}
            </Button>
          </div>
          <div class="history-view-content" ref={history}>
            <SessionList onOpen={open} />
          </div>
        </div>
      </Match>
      <Match when={view() === "chat"}>
        <SessionView
          session={session()}
          onSession={settled}
          onReferenceReady={(value) => (reference = value)}
          actions={toolActions}
          onShowHistory={() => setView("history")}
          onNewSession={startSession}
          onViewTurnChanges={openTurnChanges}
          onForkMessage={forkSession}
          row={row}
          rowWhenEmpty={!!transfer.branch()}
          onReviewAppendReady={reviewQueue.ready}
          onComposerReady={composerQueue.ready}
          draftKey={tabs.active()}
          // v1's sidebar focused the prompt whenever its draft key changed, so a switched session or a new tab type
          // straight into the composer. The Agent Manager mounts the same composer per worktree and passes its own
          // predicate, which also keeps a visible terminal in control.
          focusOnDraftChange={() => true}
          onMissing={(id) => tabs.close(id)}
          tabs={showTabStrip(tabs.ids())}
          tabStrip={
            <Show when={showTabStrip(tabs.ids())}>
              <SessionTabStrip tabs={tabs} onFork={forkSession} />
            </Show>
          }
        />
      </Match>
    </Switch>
  )
}
