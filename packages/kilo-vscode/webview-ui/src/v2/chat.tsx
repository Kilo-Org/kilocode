// The sidebar: history or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
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
import { useLanguage } from "../context/language"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
import { useV2 } from "./client"
import { useDisplaySettings } from "./display-settings"
import { SessionList } from "./history"
import { forkText } from "../../../src/agent-manager/fork-handoff"
import { createLocalTabs } from "./local-tabs"
import { SessionTabStrip } from "./session-tabs"
import { SessionView } from "./session-view"
import { chunkPaths } from "./validate-paths"
import { createReviewAppendQueue } from "./review-queue"
import { showTabStrip } from "../utils/local-tabs"
import { focusPrompt } from "../utils/tab-navigation"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const tabs = createLocalTabs()
  const [view, setView] = createSignal<"chat" | "history">("chat")
  // Comments can arrive while the chat composer is unmounted (History), so hold them until it returns.
  const reviewQueue = createReviewAppendQueue()
  const vscode = useVSCode()
  // The working tree counts the host pushes. The button reads the current value without polling.
  const [stats, setStats] = createSignal<GitChangesStats>()
  const stopStats = vscode.onMessage((raw) => {
    const message = raw as ToWebview
    if (message.type === "gitChangesStats") setStats(message.stats)
  })
  onCleanup(stopStats)
  vscode.postMessage({ type: "requestGitChangesStats" } satisfies ToHost as never)
  // Display layouts are Kilo-only config keys, so the host reads them. Ask on connect and after every config change.
  const display = useDisplaySettings()
  createEffect(
    on(v2.connection.status, (status) => {
      if (status === "connected") display.request()
    }),
  )
  onCleanup(v2.data.on("config.updated", () => display.request()))
  const startSession = () => {
    tabs.add()
    setView("chat")
  }
  const open = (id: string) => {
    tabs.open(id)
    setView("chat")
  }
  const step = (offset: -1 | 1) => {
    if (!document.hasFocus() || view() !== "chat") return
    const before = tabs.active()
    tabs.step(offset)
    if (tabs.active() !== before) requestAnimationFrame(focusPrompt)
  }
  v2.onCommand((name) => {
    if (name === "newSession") startSession()
    if (name === "history") setView("history")
    if (name === "showOpenTabs") {
      setView("chat")
      window.dispatchEvent(new Event("showOpenTabs"))
    }
    if (name === "tabPrevious") step(-1)
    if (name === "tabNext") step(1)
  })

  const forkSession = (id: string) => {
    void v2.api.session
      .fork({ sessionID: id })
      .then(async (info) => {
        await v2.api.session
          .synthetic({ sessionID: info.id, text: forkText({ directory: v2.directory }) })
          .catch(v2.report)
        v2.data.session.remember(info)
        tabs.openAfter(id, info.id)
      })
      .catch(v2.report)
  }

  const session = () => tabs.session()
  const settled = (id: string | undefined, draftKey?: string) => {
    if (!id) return tabs.close(draftKey ?? tabs.active())
    tabs.settled(draftKey ?? tabs.active(), id)
  }

  // A document tab in the editor posts review comments here, because this view owns the prompt they belong to.
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
  const toolActions: ToolActions = {
    openFile: (filePath, line, column, sessionID) =>
      getVSCodeAPI().postMessage({
        type: "openToolFile",
        filePath,
        line,
        column,
        sessionID: sessionID ?? session(),
      } satisfies ToHost as never),
    validateFiles,
    openDiff: (diff) => getVSCodeAPI().postMessage({ type: "openDiffVirtual", diff } satisfies ToHost as never),
    openDiffs: (diffs) => getVSCodeAPI().postMessage({ type: "openDiffsVirtual", diffs } satisfies ToHost as never),
    openSession: open,
  }

  const changesTooltip = () => {
    const value = stats()
    if (!value?.files) return language.t("sidebar.session.showChanges.tooltip.empty")
    return (
      <span class="session-changes-tooltip">
        <span>
          {value.files} {language.t(value.files === 1 ? "ui.common.file.one" : "ui.common.file.other")}
        </span>
        <span class="session-changes-tooltip-separator">·</span>
        <span class="session-diff-add">+{value.additions}</span>
        <span class="session-diff-del">-{value.deletions}</span>
        <span>{language.t("sidebar.session.showChanges.tooltip.empty")}</span>
      </span>
    )
  }

  // main's ChatView actions row. New Session and Changes have v2 counterparts: the worktree and fork actions need
  // the Agent Manager.
  const row = (hasMessages: boolean, todos: JSX.Element) => (
    <Show when={hasMessages}>
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
          <Tooltip value={changesTooltip()} placement="top" class="session-move-changes-trigger">
            <Button
              variant="ghost"
              size="small"
              class="session-move-changes"
              classList={{
                "session-move-changes--empty": !stats()?.files,
                "session-move-changes--has-changes": !!stats()?.files,
              }}
              onClick={openChanges}
              aria-label={language.t("command.session.show.changes")}
            >
              <Icon name="layers" size="small" />
              <Show when={stats()?.files}>
                <span class="session-diff-add">+{stats()!.additions}</span>
                <span class="session-diff-del">-{stats()!.deletions}</span>
                <span class="session-move-dot" aria-hidden="true" />
              </Show>
            </Button>
          </Tooltip>
          {todos}
        </div>
      </div>
    </Show>
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
          <div class="history-view-content">
            <SessionList onOpen={open} />
          </div>
        </div>
      </Match>
      <Match when={view() === "chat"}>
        <SessionView
          session={session()}
          onSession={settled}
          actions={toolActions}
          onShowHistory={() => setView("history")}
          onViewTurnChanges={openTurnChanges}
          row={row}
          onReviewAppendReady={reviewQueue.ready}
          draftKey={tabs.active()}
          onMissing={(id) => tabs.close(id)}
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
