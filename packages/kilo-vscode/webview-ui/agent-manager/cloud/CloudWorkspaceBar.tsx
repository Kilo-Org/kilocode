import { createMemo, For, Show } from "solid-js"
import type { OpenCodeClient } from "@opencode/client"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ActivityIcon } from "../../src/components/shared/ActivityIcon"
import { useLanguage } from "../../src/context/language"
import type { createTabFocus } from "../../src/utils/tab-navigation"
import { ClosableTabChrome } from "../ClosableTab"
import { SessionTabList } from "../SessionTabList"
import { WorkspaceTabBar, WorkspaceTerminalButton } from "../WorkspaceTabBar"
import { renderNewTabButton } from "../tab-rendering"
import { useTabScroll } from "../tab-scroll"
import { label } from "../v2/activity"
import { SessionMenu } from "./SessionMenu"
import { focusCloudChat } from "./focus"
import type { ChatRoute, CloudNavigation } from "./route"

export function CloudWorkspaceBar(props: {
  nav: CloudNavigation
  api: OpenCodeClient
  bindings: () => Record<string, string>
  collapsed: boolean
  toggle: () => void
  visible?: "terminal" | "review" | "edit"
  openSide: (name: "terminal" | "review", route: ChatRoute) => void
  newTerminal: (route: ChatRoute) => void
  refresh: (directory: string) => void
  activate: (id: string) => void
  focus: ReturnType<typeof createTabFocus>
}) {
  const { t } = useLanguage()
  const session = createMemo(() => {
    const route = props.nav.current()
    return route?.kind === "session" ? route : undefined
  })
  const draft = createMemo(() => {
    const route = props.nav.current()
    return route?.kind === "create" ? route : undefined
  })
  const tabs = createMemo(props.nav.tabs)
  const ids = createMemo(() => tabs().map((tab) => tab.target.sessionID))
  const active = () => session()?.target.sessionID ?? "cloud-draft"
  const scroll = useTabScroll(ids, active)
  return (
    <WorkspaceTabBar
      collapsed={props.collapsed}
      toggle={props.toggle}
      add={
        !draft() &&
        renderNewTabButton({
          contextSelected: () => true,
          kb: props.bindings,
          newSessionLabel: t("agentManager.session.new"),
          newSessionMenuLabel: t("agentManager.session.newSession"),
          moreOptionsLabel: t("agentManager.tab.newOptions"),
          newTerminalLabel: t("agentManager.terminal.new"),
          onNewSession: () => {
            const route = session()
            if (route) props.nav.select({ ...route, kind: "create", workspaceID: route.target.workspaceID })
          },
          onNewTerminal: () => {
            const route = session()
            if (route) props.newTerminal(route)
          },
        })
      }
      actions={
        <Show when={session()}>
          {(route) => (
            <>
              <Show when={route()} keyed>
                {(target) => (
                  <SessionMenu
                    route={target}
                    api={props.api}
                    nav={props.nav}
                    refresh={() => props.refresh(target.directory)}
                  />
                )}
              </Show>
              <TooltipKeybind
                title={t("agentManager.diff.toggle")}
                keybind={props.bindings().toggleDiff ?? ""}
                placement="bottom"
                openDelay={0}
              >
                <IconButton
                  icon="layers"
                  size="small"
                  variant="ghost"
                  class="am-diff-toggle-btn"
                  aria-label={t("agentManager.diff.toggle")}
                  aria-pressed={props.visible === "review"}
                  onClick={() => props.openSide("review", route())}
                />
              </TooltipKeybind>
              <WorkspaceTerminalButton
                active={props.visible === "terminal"}
                keybind={props.bindings().showTerminal ?? ""}
                open={() => props.openSide("terminal", route())}
              />
            </>
          )}
        </Show>
      }
    >
      <SessionTabList
        scroll={scroll}
        count={ids().length + Number(!!draft())}
        label={t("agentManager.shortcuts.category.tabs")}
      >
        <For each={ids()}>
          {(id, index) => {
            const tab = () => tabs()[index()]!
            const state = () => props.nav.state(tab())
            return (
              <div class="am-tab-item">
                <ClosableTabChrome
                  id={id}
                  role="tab"
                  selected={active() === id}
                  active={active() === id}
                  tabIndex={active() === id ? 0 : -1}
                  label={tab().title}
                  tooltip={tab().title}
                  state={state()}
                  icon="cloud"
                  stateLabel={t(label(state()))}
                  iconNode={() => <ActivityIcon state={state()} idle={<Icon name="cloud" size="small" />} />}
                  onSelect={() => props.activate(id)}
                  onClose={() => props.focus.run(() => props.nav.close(tab()))}
                  onKeyDown={(e) => props.focus.key(id, e)}
                />
              </div>
            )
          }}
        </For>
        <Show when={draft()}>
          {(route) => (
            <div class="am-tab-item">
              <ClosableTabChrome
                id="cloud-draft"
                role="tab"
                selected
                active
                tabIndex={0}
                label={t(route().workspaceID ? "agentManager.cloud.newSession" : "agentManager.cloud.newWorkspace")}
                tooltip={t("session.tab.cloud")}
                icon={props.nav.state(route()) === "busy" ? "spinner" : "cloud"}
                onSelect={() => focusCloudChat()}
                onClose={() => props.focus.run(props.nav.cancelDraft)}
                onKeyDown={(e) => props.focus.key("cloud-draft", e)}
              />
            </div>
          )}
        </Show>
      </SessionTabList>
    </WorkspaceTabBar>
  )
}
