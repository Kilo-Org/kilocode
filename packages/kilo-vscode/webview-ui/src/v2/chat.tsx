// The sidebar: history, profile, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { createEffect, createSignal, type JSX, Match, on, onCleanup, Show, Switch } from "solid-js"
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

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const [session, setSession] = createSignal<string>()
  const [view, setView] = createSignal<"chat" | "history" | "profile">("chat")
  const [changes, setChanges] = createSignal(false)
  // Display layouts are Kilo-only config keys, so the host reads them. Ask on connect and after every config change.
  const display = useDisplaySettings()
  // An element reference picked in the Integrated Browser arrives from the host as text for the composer.
  const vscode = useVSCode()
  let append: ((value: string, send: boolean) => void) | undefined
  onCleanup(
    vscode.onMessage((message) => {
      if (message.type !== "browserReference") return
      append?.(message.text, false)
    }),
  )
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
          <Button
            variant="secondary"
            size="small"
            aria-pressed={changes()}
            onClick={() => setChanges((open) => !open)}
          >
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
          onAppendReady={(value) => (append = value)}
          actions={toolActions}
          onShowHistory={() => setView("history")}
          row={row}
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
