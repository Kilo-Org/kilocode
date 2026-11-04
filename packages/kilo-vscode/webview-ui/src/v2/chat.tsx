// The sidebar: history, profile, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
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
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { getVSCodeAPI, useVSCode } from "../context/vscode"
import { useV2 } from "./client"
import { useDisplaySettings } from "./display-settings"
import { SessionList } from "./history"
import ProfileView from "../components/profile/ProfileView"
import { createProfile } from "./profile"
import { SessionChanges } from "./session-changes"
import { SessionView } from "./session-view"
import { formatReviewCommentsMarkdown } from "../utils/review-comment-markdown"
import { chunkPaths } from "./validate-paths"
import { createReviewAppendQueue } from "./review-queue"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [view, setView] = createSignal<"chat" | "history" | "profile">("chat")
  // Comments can arrive while the chat composer is unmounted (History or Profile), so hold them until it returns.
  const reviewQueue = createReviewAppendQueue()
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

  // A document tab in the editor posts review comments here, because this view owns the prompt they belong to.
  const vscode = useVSCode()
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
      reviewQueue.push(formatReviewCommentsMarkdown(item.comments), item.autoSend)
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
  // A turn shows its own changes: `from` is the user message that opened it, and the
  // server ends the range at the next idle marker.
  const openTurnChanges = (sessionID: string, turnID: string) => {
    void v2.api.session
      .diff({ sessionID, from: turnID })
      .then((files) => {
        if (files.length === 0) {
          showToast(language.t("session.review.turnChangesEmpty"))
          return
        }
        getVSCodeAPI().postMessage({
          type: "openDiffsVirtual",
          diffs: files.map((file) => ({
            file: file.file,
            patch: file.patch,
            additions: file.additions,
            deletions: file.deletions,
          })),
        } satisfies ToHost as never)
      })
      .catch(v2.report)
  }

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

  // main's ChatView actions row. New Session and Changes have v2 counterparts: the worktree and fork actions need
  // the Agent Manager, and the changes view lists this session's files instead of the working tree.
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
          <Button variant="secondary" size="small" aria-pressed={changes()} onClick={() => setChanges((open) => !open)}>
            {language.t("sidebar.session.changes.title")}
          </Button>
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
      <Match when={view() === "profile"}>
        <ProfileView profile={profile} />
      </Match>
      <Match when={view() === "chat"}>
        <SessionView
          session={session()}
          onSession={setSession}
          actions={toolActions}
          onShowHistory={() => setView("history")}
          onViewTurnChanges={openTurnChanges}
          row={row}
          onAppendReady={reviewQueue.ready}
          replace={changes() && !!session()}
          replacement={
            <Show when={changes() ? session() : undefined} keyed>
              {(id) => <SessionChanges sessionID={id} onClose={() => setChanges(false)} />}
            </Show>
          }
        />
      </Match>
    </Switch>
  )
}
