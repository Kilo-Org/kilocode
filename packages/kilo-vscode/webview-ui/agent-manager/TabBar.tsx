import { For, Show, type Component, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import type { LocalGitStats, RunStatus, WorktreeGitStats } from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import { LOCAL } from "./navigate"
import { ConstrainDragYAxis } from "../src/components/chat/TabDnd"
import type { tracker } from "./telemetry"
import { SidebarToggleButton } from "./SidebarToggleButton"

/** Everything the tab bar reads from the app. */
export interface TabBarProps {
  t: LanguageContextValue["t"]
  bindings: () => Record<string, string>
  selection: () => string | null
  empty: () => boolean
  collapsed: boolean
  onToggleSidebar: () => void
  scroll: { setRef: (el: HTMLDivElement) => void; showLeft: () => boolean; showRight: () => boolean }
  ids: () => string[]
  renderTab: (id: string) => JSX.Element
  newTab: () => JSX.Element
  onDragStart: (event: DragEvent) => void
  onDragEnd: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onRelease: () => void
  overlay: () => { title?: string } | undefined
  localStats: () => LocalGitStats | undefined
  worktreeStats: () => Record<string, WorktreeGitStats>
  applyState: () => { status: string } | undefined
  onOpen: () => void
  onApply: () => void
  runStatuses: () => Record<string, RunStatus>
  runConfigured: () => boolean
  onRun: (id: string) => void
  onConfigureRun: () => void
  diffOpen: () => boolean
  reviewActive: () => boolean
  onToggleDiff: () => void
  onToggleReview: () => void
  onShowTerminal: () => void
  track: ReturnType<typeof tracker>["click"]
}

/** Tab bar with sortable session/terminal/review tabs and the run/diff/apply actions. */
export const TabBar: Component<TabBarProps> = (props) => (
  <Show
    when={props.selection() !== null && !props.empty()}
    fallback={
      <div class="am-tab-bar am-tab-bar-empty">
        <div class="am-tab-leading">
          <SidebarToggleButton collapsed={props.collapsed} onClick={props.onToggleSidebar} />
        </div>
      </div>
    }
  >
    <DragDropProvider
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      collisionDetector={closestCenter}
    >
      <DragDropSensors />
      <ConstrainDragYAxis />
      <div class="am-tab-bar" onPointerLeave={props.onRelease}>
        <div class="am-tab-leading">
          <SidebarToggleButton collapsed={props.collapsed} onClick={props.onToggleSidebar} />
        </div>
        <div class="am-tab-scroll-area">
          <div class={`am-tab-fade am-tab-fade-left ${props.scroll.showLeft() ? "am-tab-fade-visible" : ""}`} />
          <div class="am-tab-list-wrap">
            <div
              class="am-tab-list"
              ref={props.scroll.setRef}
              role="tablist"
              aria-label={props.t("agentManager.shortcuts.category.tabs")}
              style={{ "--tab-count": `${props.ids().length}` } as JSX.CSSProperties}
            >
              <SortableProvider ids={props.ids()}>
                <For each={props.ids()}>{(id) => props.renderTab(id)}</For>
              </SortableProvider>
            </div>
          </div>
          <div class={`am-tab-fade am-tab-fade-right ${props.scroll.showRight() ? "am-tab-fade-visible" : ""}`} />
        </div>
        <Show when={props.selection() !== null}>
          <div class="am-tab-add-wrap">
            <div class="am-tab-add-separator" />
            {props.newTab()}
          </div>
        </Show>
        <div class="am-tab-actions">
          {(() => {
            const sel = () => props.selection()
            const isWorktree = () => typeof sel() === "string" && sel() !== LOCAL
            const stats = () => {
              if (sel() === LOCAL) return props.localStats()
              return typeof sel() === "string" ? props.worktreeStats()[sel() as string] : undefined
            }
            const hasChanges = () => {
              const s = stats()
              return s && (s.files > 0 || s.additions > 0 || s.deletions > 0)
            }
            const applyBusy = () => {
              const state = props.applyState()
              if (!state) return false
              return state.status === "checking" || state.status === "applying"
            }
            return (
              <>
                <Show when={isWorktree()}>
                  <>
                    <Tooltip value={props.t("agentManager.open.tooltip")} placement="bottom">
                      <Button size="small" variant="ghost" icon="folder" onClick={props.onOpen}>
                        {props.t("agentManager.open.button")}
                      </Button>
                    </Tooltip>
                    <Tooltip value={props.t("agentManager.apply.tooltip")} placement="bottom">
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={props.onApply}
                        disabled={!hasChanges() || applyBusy()}
                      >
                        <Show when={applyBusy()}>
                          <Spinner class="am-apply-spinner" />
                        </Show>
                        {props.t("agentManager.apply.globalButton")}
                      </Button>
                    </Tooltip>
                  </>
                </Show>
                <Show when={sel()}>
                  {(() => {
                    const rid = () => (sel() === LOCAL ? LOCAL : (sel() as string))
                    const rs = () => props.runStatuses()[rid()]
                    const active = () => rs()?.state === "running" || rs()?.state === "stopping"
                    const configured = props.runConfigured
                    const title = () => (configured() ? (active() ? "Stop" : "Run") : "Configure run script")
                    return (
                      <span
                        class={`am-run-group ${active() ? "am-run-active" : ""} ${!configured() ? "am-run-unconfigured" : ""}`}
                      >
                        <TooltipKeybind title={title()} keybind={props.bindings().runScript ?? ""} placement="bottom">
                          <Button
                            size="small"
                            variant="ghost"
                            icon={active() ? "stop" : "play"}
                            disabled={rs()?.state === "stopping"}
                            onClick={props.track(
                              "run_script",
                              "tab_toolbar",
                              () => props.onRun(rid()),
                              () => ({
                                action: active() ? "stop" : configured() ? "run" : "configure",
                              }),
                            )}
                          >
                            {active() ? "Stop" : "Run"}
                          </Button>
                        </TooltipKeybind>
                        <DropdownMenu gutter={4} placement="bottom-end">
                          <DropdownMenu.Trigger
                            as={(p: Record<string, unknown>) => (
                              <IconButton
                                {...p}
                                icon="chevron-down"
                                size="small"
                                variant="ghost"
                                label={props.t("agentManager.run.options")}
                                class="am-run-group-chevron"
                              />
                            )}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="am-split-menu">
                              <DropdownMenu.Item
                                onSelect={props.track("configure_run_script", "run_menu", props.onConfigureRun)}
                              >
                                <Icon name="settings-gear" size="small" />
                                <DropdownMenu.ItemLabel>{props.t("agentManager.run.configure")}</DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </span>
                    )
                  })()}
                </Show>
                <TooltipKeybind
                  title={props.t("agentManager.diff.toggle")}
                  keybind={props.bindings().toggleDiff ?? ""}
                  placement="bottom"
                >
                  <button
                    class={`am-diff-toggle-btn ${props.diffOpen() && !props.reviewActive() ? "am-tab-diff-btn-active" : ""} ${hasChanges() ? "am-diff-toggle-has-changes" : ""}`}
                    onClick={props.onToggleDiff}
                    title={props.t("agentManager.diff.toggle")}
                  >
                    <Icon name="layers" size="small" />
                    <Show when={hasChanges()}>
                      <span class="am-diff-toggle-stats">
                        <Show when={stats()!.files > 0}>
                          <span class="am-stat-files">{stats()!.files}f</span>
                        </Show>
                        <span class="am-stat-additions">+{stats()!.additions}</span>
                        <span class="am-stat-deletions">−{stats()!.deletions}</span>
                      </span>
                    </Show>
                  </button>
                </TooltipKeybind>
              </>
            )
          })()}
          <Show when={props.selection() !== null}>
            <Tooltip value={props.t("command.review.toggle")} placement="bottom">
              <IconButton
                icon="expand"
                size="small"
                variant="ghost"
                label={props.t("command.review.toggle")}
                class={props.reviewActive() ? "am-tab-diff-btn-active" : ""}
                onClick={props.onToggleReview}
              />
            </Tooltip>
          </Show>
          {/* Legacy VS Code integrated terminal shortcut. Coexists with the
              xterm terminal tabs (accessed via the `+` split-button or
              Cmd+Shift+T): Cmd+/ still opens the integrated terminal for the
              active session. */}
          <TooltipKeybind
            title={props.t("agentManager.tab.terminal")}
            keybind={props.bindings().showTerminal ?? ""}
            placement="bottom"
          >
            <IconButton
              icon="console"
              size="small"
              variant="ghost"
              label={props.t("agentManager.tab.openTerminal")}
              onClick={props.onShowTerminal}
            />
          </TooltipKeybind>
        </div>
      </div>
      <DragOverlay>
        <Show when={props.overlay()}>
          {(tab) => (
            <div class="am-tab am-tab-overlay">
              <span class="am-tab-label">{tab().title || props.t("agentManager.session.untitled")}</span>
            </div>
          )}
        </Show>
      </DragOverlay>
    </DragDropProvider>
  </Show>
)
