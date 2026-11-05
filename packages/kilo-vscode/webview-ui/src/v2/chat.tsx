// The sidebar: history, profile, or one session laid out like main's ChatView (transcript, docks, prompt).
import { Button } from "@kilocode/kilo-ui/button"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { createEffect, createSignal, type JSX, Match, on, onCleanup, Show, Switch } from "solid-js"
import type { ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { getVSCodeAPI } from "../context/vscode"
import { useV2 } from "./client"
import { useDisplaySettings } from "./display-settings"
import { SessionList } from "./history"
import ProfileView from "../components/profile/ProfileView"
import { forkText } from "../../../src/agent-manager/fork-handoff"
import { createLocalTabs } from "./local-tabs"
import { createProfile } from "./profile"
import { SessionChanges } from "./session-changes"
import { SessionTabStrip } from "./session-tabs"
import { SessionView } from "./session-view"
import { showTabStrip } from "../utils/local-tabs"
import { focusPrompt } from "../utils/tab-navigation"

export function Chat() {
  const v2 = useV2()
  const language = useLanguage()
  const tabs = createLocalTabs()
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
  // A turn's changes belong to its tab, so switching tabs returns to that tab's chat.
  createEffect(on(tabs.active, () => setChanges(false), { defer: true }))
  const startSession = () => {
    tabs.add()
    setView("chat")
    setChanges(false)
  }
  const open = (id: string) => {
    tabs.open(id)
    setView("chat")
    setChanges(false)
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
    if (name === "profile") setView("profile")
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
          onSession={settled}
          actions={toolActions}
          onShowHistory={() => setView("history")}
          onViewTurnChanges={openTurnChanges}
          row={row}
          replace={changes() && !!session()}
          replacement={
            <Show when={changes() ? session() : undefined} keyed>
              {(id) => <SessionChanges sessionID={id} onClose={() => setChanges(false)} />}
            </Show>
          }
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
