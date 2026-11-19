import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { showToast } from "@kilocode/kilo-ui/toast"
import { readListed } from "../../../src/shared/plugin-inventory"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { createSessionPool } from "./session-pool"
import { CloudInspector } from "./inspector"
import { createCloudToolPreview, type DiffPreferences } from "./tool-diff"
import { createCloudStatus } from "./status"
import { ActivityIcon } from "../../src/components/shared/ActivityIcon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { label } from "../v2/activity"
import { createCloudShells, cloudShellAction, type CloudShells } from "./shell-tabs"
import { ClosableTabChrome } from "../ClosableTab"
import { V2Scope } from "../../src/v2/client"
import { useBridge } from "../v2/vscode"

import { useLanguage } from "../../src/context/language"
import type { AgentProjectSnapshot } from "../../src/types/messages/agent-manager"
import { cloudWorkspacesVisible } from "../../src/v2/kilo-settings"
import { HostedChat } from "../hosted-chat"
import type { PanelData } from "../v2/panel-data"
import { SessionTabList } from "../SessionTabList"
import { WorkspaceTabBar, WorkspaceTerminalButton } from "../WorkspaceTabBar"
import { useTabScroll } from "../tab-scroll"
import { renderNewTabButton } from "../tab-rendering"
import { SessionMenu } from "./SessionMenu"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { CloudCreate } from "./CloudCreate"
import { createTabFocus } from "../../src/utils/tab-navigation"
import { bindCloudFocus, focusCloudChat } from "./focus"
import { CloudRow } from "./CloudRow"
import { createCloudNavigation, type ChatRoute, type CloudRoute } from "./route"
import "./cloud.css"

export function createCloudSurface(input: {
  diffPreferences: DiffPreferences
  panel: PanelData
  projects: () => readonly AgentProjectSnapshot[]
  allowed: (id: string) => boolean
  collapsed: () => boolean
  toggle: () => void
}) {
  const { t } = useLanguage()
  const bridge = useBridge()
  const pool = createSessionPool(input.panel.api)
  onCleanup(() => pool.clear())
  const nav = createCloudNavigation(window.localStorage, pool.activity)
  const group = (r: CloudRoute) =>
    JSON.stringify([r.directory, r.scope, r.kind === "session" ? r.target.workspaceID : r.workspaceID])
  const currentGroup = () => {
    const r = nav.current()
    return r && group(r)
  }
  const selectTab = (id: string) => {
    const tab = nav.tabs().find((item) => item.target.sessionID === id)
    if (tab) nav.select(tab)
  }
  const activateTab = (id: string) => {
    selectTab(id)
    focusCloudChat()
  }
  const sessionTabFocus = createTabFocus({
    ids: () => [
      ...nav.tabs().map((tab) => tab.target.sessionID),
      ...(nav.current()?.kind === "create" ? ["cloud-draft"] : []),
    ],
    select: selectTab,
    activate: activateTab,
    root: () => document.querySelector(".am-cloud-detail"),
  })
  const [shells, setShells] = createSignal<CloudShells>()
  const [panel, setPanel] = createSignal<"terminal" | "review" | "edit">()
  const edits = createCloudToolPreview(
    (route) => nav.current() === route && pool.observed(route.directory, route.target) !== undefined,
    input.diffPreferences,
    () => setPanel("edit"),
    () => setPanel(undefined),
  )
  createEffect(() => {
    if (panel() !== "edit") edits.clear()
    else if (!edits.preview()) edits.close()
  })
  const scroll = useTabScroll(nav.tabs, () => {
    const r = nav.current()
    return r?.kind === "session" ? r.target.sessionID : "cloud-draft"
  })
  const openSide = (name: "terminal" | "review", route: ChatRoute) => {
    if (panel() === name) {
      setPanel(undefined)
      focusCloudChat(true)
      return
    }
    if (name === "terminal") {
      const shell = shells() ?? setShells(createCloudShells(route))
      setPanel(name)
      shell.focus(shell.active())
      return
    }
    setPanel(name)
  }
  const closeShell = () => {
    setShells(undefined)
    setPanel(undefined)
    focusCloudChat()
  }
  const newTerminal = (route: ChatRoute) => {
    const existing = shells()
    if (existing) existing.add()
    else setShells(createCloudShells(route))
    setPanel("terminal")
  }
  createEffect((last: string | undefined) => {
    const next = currentGroup()
    if (last !== next) {
      setShells(undefined)
      setPanel(undefined)
    }
    return next
  })
  const [versions, setVersions] = createSignal<Record<string, number>>({})
  const refresh = (directory: string) => setVersions((prev) => ({ ...prev, [directory]: (prev[directory] ?? 0) + 1 }))
  onCleanup(
    input.panel.onHostedChange((directory) => {
      pool.clear(directory)
      nav.invalidate(directory)
      if (directory) refresh(directory)
      else input.projects().forEach((p) => refresh(p.root))
    }),
  )
  const shown = (id: string) => cloudWorkspacesVisible() && input.allowed(id)
  createEffect(() => {
    const current = nav.current()
    if (!current) return
    const exists = input
      .projects()
      .some((p) => p.id === current.projectID && p.root === current.directory && !p.missing)
    if (!exists || !shown(current.projectID)) nav.leave()
  })
  return {
    activity: createCloudStatus(
      nav,
      pool,
      (route) =>
        shown(route.projectID) &&
        input.projects().some((p) => p.id === route.projectID && p.root === route.directory && !p.missing),
    ),
    enabled: cloudWorkspacesVisible,
    async create(id: string) {
      const p = input.projects().find((p) => p.id === id)
      if (!p || !shown(id) || p.missing) return
      try {
        const status = await readListed({
          api: input.panel.api,
          directory: p.root,
          active: () => shown(id),
          read: () => input.panel.api.rpc(KiloHostedRpc.Definition).status({}, { location: { directory: p.root } }),
        })
        if (status.state === "ready" && status.scope && status.repository) {
          nav.select({
            kind: "create",
            projectID: id,
            directory: p.root,
            scope: status.scope,
            restoreKey: status.restoreKey,
            repository: status.repository,
          })
          return
        }
        const key =
          status.state === "signed_out"
            ? "agentManager.cloud.signedOut"
            : status.state === "no_repository"
              ? "agentManager.cloud.noRepository"
              : "agentManager.cloud.unsupported"
        showToast({ title: t(key) })
      } catch {
        showToast({ title: t("agentManager.cloud.loadFailed") })
      }
    },
    current: nav.current,
    action(name: string) {
      const route = nav.current()
      if (!route) return
      if (name === "focusInput") {
        focusCloudChat(true)
        return
      }
      if (panel() === "terminal" && cloudShellAction(name, shells(), closeShell)) return
      if (name === "closeTask" || name === "closeTab") {
        sessionTabFocus.run(() => (route.kind === "session" ? nav.close(route) : nav.cancelDraft()))
        return
      }
      if (route.kind !== "session") return
      if (name === "newTab") nav.select({ ...route, kind: "create", workspaceID: route.target.workspaceID })
      if (name === "showTerminal") openSide("terminal", route)
      if (["newTerminalCenter", "newTerminalTab", "newSideTerminal"].includes(name)) newTerminal(route)
      if (name === "toggleDiff") openSide("review", route)
      if (name === "tabNext" || name === "tabPrevious") {
        const tabs = nav.tabs()
        activateTab(
          tabs[(tabs.indexOf(route) + tabs.length + (name === "tabNext" ? 1 : -1)) % tabs.length]!.target.sessionID,
        )
      }
    },
    leave: nav.leave,
    sidebar: (p: AgentProjectSnapshot) => (
      <Show when={shown(p.id)}>
        <CloudRow project={p} panel={input.panel} nav={nav} revision={versions()[p.root] ?? 0} />
      </Show>
    ),
    detail: (native: () => JSX.Element) => (
      <Show when={currentGroup()} keyed fallback={native()}>
        {(_workspace) => {
          const selected = () => nav.current()!
          const chat = () => {
            const r = selected()
            return r.kind === "session" ? r : undefined
          }
          return (
            <div
              class="am-detail am-cloud-detail"
              ref={(el) =>
                onCleanup(
                  bindCloudFocus(el, (target) => bridge.postMessage({ type: "agentManagerFocusChanged", target })),
                )
              }
              data-agent-manager-native-text-shortcuts
            >
              <Show when={selected()} keyed>
                {(route) => (
                  <WorkspaceTabBar
                    collapsed={input.collapsed()}
                    toggle={input.toggle}
                    add={
                      route.kind === "session" &&
                      renderNewTabButton({
                        contextSelected: () => true,
                        kb: input.panel.store(route.directory).bindings,
                        newSessionLabel: t("agentManager.session.new"),
                        newSessionMenuLabel: t("agentManager.session.newSession"),
                        moreOptionsLabel: t("agentManager.tab.newOptions"),
                        newTerminalLabel: t("agentManager.terminal.new"),
                        onNewSession: () =>
                          nav.select({ ...route, kind: "create", workspaceID: route.target.workspaceID }),
                        onNewTerminal: () => newTerminal(route),
                      })
                    }
                    actions={
                      route.kind === "session" && (
                        <>
                          <SessionMenu
                            route={route}
                            api={input.panel.api}
                            nav={nav}
                            refresh={() => refresh(route.directory)}
                          />
                          <TooltipKeybind
                            title={t("agentManager.diff.toggle")}
                            keybind={input.panel.store(route.directory).bindings().toggleDiff ?? ""}
                            placement="bottom"
                            openDelay={0}
                          >
                            <IconButton
                              icon="layers"
                              size="small"
                              variant="ghost"
                              class="am-diff-toggle-btn"
                              aria-label={t("agentManager.diff.toggle")}
                              aria-pressed={panel() === "review"}
                              onClick={() => openSide("review", route)}
                            />
                          </TooltipKeybind>
                          <WorkspaceTerminalButton
                            active={panel() === "terminal"}
                            keybind={input.panel.store(route.directory).bindings().showTerminal ?? ""}
                            open={() => openSide("terminal", route)}
                          />
                        </>
                      )
                    }
                  >
                    <SessionTabList
                      scroll={scroll}
                      count={nav.tabs().length + Number(route.kind === "create")}
                      label={t("agentManager.shortcuts.category.tabs")}
                    >
                      <For each={nav.tabs()}>
                        {(tab) => (
                          <ClosableTabChrome
                            id={tab.target.sessionID}
                            role="tab"
                            selected={route === tab}
                            active={route === tab}
                            tabIndex={route === tab ? 0 : -1}
                            label={tab.title}
                            tooltip={tab.title}
                            state={nav.state(tab)}
                            icon="cloud"
                            stateLabel={t(label(nav.state(tab)))}
                            iconNode={() => (
                              <ActivityIcon state={nav.state(tab)} idle={<Icon name="cloud" size="small" />} />
                            )}
                            onSelect={() => activateTab(tab.target.sessionID)}
                            onClose={() => sessionTabFocus.run(() => nav.close(tab))}
                            onKeyDown={(e) => sessionTabFocus.key(tab.target.sessionID, e)}
                          />
                        )}
                      </For>
                      <Show when={route.kind === "create"}>
                        <ClosableTabChrome
                          id="cloud-draft"
                          role="tab"
                          selected
                          active
                          tabIndex={0}
                          label={t(
                            route.kind === "create" && route.workspaceID
                              ? "agentManager.cloud.newSession"
                              : "agentManager.cloud.newWorkspace",
                          )}
                          tooltip={t("session.tab.cloud")}
                          icon={nav.state(route) === "busy" ? "spinner" : "cloud"}
                          onSelect={() => focusCloudChat()}
                          onClose={() => sessionTabFocus.run(nav.cancelDraft)}
                          onKeyDown={(e) => sessionTabFocus.key("cloud-draft", e)}
                        />
                      </Show>
                    </SessionTabList>
                  </WorkspaceTabBar>
                )}
              </Show>
              <V2Scope value={input.panel.store(selected().directory)}>
                <div class="am-detail-stack">
                  <CloudInspector
                    edits={edits}
                    diffPreferences={input.diffPreferences}
                    api={input.panel.api}
                    route={chat()}
                    shells={shells()}
                    visible={panel()}
                    close={() => {
                      setPanel(undefined)
                      focusCloudChat()
                    }}
                    closeShell={closeShell}
                  >
                    <Show when={selected()} keyed>
                      {(route) =>
                        route.kind === "create" ? (
                          <CloudCreate route={route} api={input.panel.api} nav={nav} refresh={refresh} />
                        ) : (
                          <HostedChat
                            diffActions={edits.actions(route)}
                            pool={pool}
                            directory={route.directory}
                            target={route.target}
                            initial={route.initial}
                          />
                        )
                      }
                    </Show>
                  </CloudInspector>
                </div>
              </V2Scope>
            </div>
          )
        }}
      </Show>
    ),
  }
}
