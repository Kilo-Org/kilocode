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
import type { LocalGitStats, RunStatus, WorktreeGitStats, PRStatus } from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import { LOCAL } from "./navigate"
import { ConstrainDragYAxis } from "../src/components/chat/TabDnd"
import type { tracker } from "./telemetry"
import { SidebarToggleButton } from "./SidebarToggleButton"
import type { DiffScope } from "./diff-scope-state"
import { TerminalDestinationButton } from "./terminal/TerminalDestinationButton"
import type { TerminalDestination } from "../src/types/messages/agent-manager"

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
  /** Active diff scope; applying to local is only possible from the branch scope. */
  reviewScope: () => DiffScope
  onOpen: () => void
  onApply: () => void
  runStatuses: () => Record<string, RunStatus>
  runConfigured: () => boolean
  onRun: (id: string) => void
  onConfigureRun: () => void
  diffOpen: () => boolean
  browserOpen: () => boolean
  browserAutomation: () => boolean
  onToggleBrowser: () => void
  reviewActive: () => boolean
  onToggleDiff: () => void
  onToggleReview: () => void
  prStatus: () => PRStatus | undefined
  prOpen: () => boolean
  onTogglePR: () => void
  documentsOpen: () => boolean
  documentsAvailable: () => boolean
  onToggleDocuments: () => void
  subagentsAvailable: () => boolean
  subagentsOpen: () => boolean
  onToggleSubagents: () => void
  terminalDestination: () => TerminalDestination
  terminalDestinationActive: () => boolean
  terminalKeybind: () => string
  onTerminalDestinationOpen: () => void
  onTerminalDestinationChoose: (destination: TerminalDestination) => void
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
                    <Tooltip
                      value={
                        props.reviewScope() === "branch"
                          ? props.t("agentManager.apply.tooltip")
                          : props.t("agentManager.diff.applyBranchOnly")
                      }
                      placement="bottom"
                    >
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={props.onApply}
                        disabled={!hasChanges() || applyBusy() || props.reviewScope() !== "branch"}
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
                        class={`am-split-button am-run-group ${active() ? "am-run-active" : ""} ${!configured() ? "am-run-unconfigured" : ""}`}
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
                          <DropdownMenu.Trigger class="am-split-arrow" aria-label={props.t("agentManager.run.options")}>
                            <Icon name="chevron-down" size="small" />
                          </DropdownMenu.Trigger>
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
                <Show when={props.prStatus()}>
                  {(pr) => (
                    <Tooltip value={`PR #${pr().number}`} placement="bottom">
                      <IconButton
                        icon="pull-request"
                        size="small"
                        variant="ghost"
                        label={`PR #${pr().number}`}
                        class={props.prOpen() ? "am-tab-diff-btn-active" : ""}
                        onClick={props.onTogglePR}
                      />
                    </Tooltip>
                  )}
                </Show>
                <Show when={props.documentsAvailable()}>
                  <Tooltip value={props.t("agentManager.documents.toggle")} placement="bottom">
                    <IconButton
                      icon="book-open-check"
                      size="small"
                      variant="ghost"
                      label={props.t("agentManager.documents.toggle")}
                      class={props.documentsOpen() ? "am-tab-diff-btn-active" : ""}
                      onClick={props.onToggleDocuments}
                    />
                  </Tooltip>
                </Show>
                <Show when={props.subagentsAvailable()}>
                  <Tooltip value="Subagents" placement="bottom">
                    <IconButton
                      icon="task"
                      size="small"
                      variant="ghost"
                      label="Subagents"
                      class={props.subagentsOpen() ? "am-tab-diff-btn-active" : ""}
                      onClick={props.onToggleSubagents}
                    />
                  </Tooltip>
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
                <Show when={props.browserAutomation()}>
                  <Tooltip value={props.t("agentManager.browser.title")} placement="bottom">
                    <IconButton
                      icon="globe"
                      size="small"
                      variant="ghost"
                      aria-label={props.t("agentManager.browser.title")}
                      class={props.browserOpen() ? "am-tab-diff-btn-active" : ""}
                      onClick={props.onToggleBrowser}
                    />
                  </Tooltip>
                </Show>
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
          {/* Terminal destination split button: the primary action
               follows the user's setting (VS Code integrated terminal
               or the embedded side panel), the dropdown picks which.
               Cmd+Shift+T creates a central terminal from center focus. Cmd+T creates a session in the center or a terminal in the right sidebar. */}
          <TerminalDestinationButton
            destination={props.terminalDestination}
            active={props.terminalDestinationActive}
            keybind={props.terminalKeybind}
            onOpen={props.onTerminalDestinationOpen}
            onChoose={props.onTerminalDestinationChoose}
          />
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
