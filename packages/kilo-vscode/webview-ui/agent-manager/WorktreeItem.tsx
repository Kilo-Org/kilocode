/**
 * Sidebar worktree item with inline delete confirmation, HoverCard, rename, and stats.
 * Extracted from AgentManagerApp for reuse and visual-regression testing via Storybook.
 */
import { Component, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { HoverCard } from "@kilocode/kilo-ui/hover-card"
import { Button } from "@kilocode/kilo-ui/button"
import type { WorktreeState, WorktreeGitStats } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { formatRelativeDate } from "../src/utils/date"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

interface WorktreeItemProps {
  worktree: WorktreeState
  /** Display label (resolved from label, first session title, or branch). */
  label: string
  active: boolean
  pendingDelete: boolean
  busy: boolean
  /** Whether an agent session on this worktree is actively working (shows spinner instead of branch icon). */
  working: boolean
  stale: boolean
  /** 1-indexed shortcut number shown as ⌘2, ⌘3, etc. Pass 0 or >9 to hide. */
  shortcut: number
  stats?: WorktreeGitStats
  /** Navigation hint text shown in the hover card (e.g. "⌘⌥↑"). */
  navHint?: string
  /** Number of sessions attached to this worktree. */
  sessions: number
  /** Whether this worktree is part of a multi-version group. */
  grouped: boolean
  /** Whether this is the first item in a group. */
  groupStart: boolean
  /** Whether this is the last item in a group. */
  groupEnd: boolean
  /** Group size (only used when groupStart is true). */
  groupSize: number
  /** Whether renaming is active on this item. */
  renaming: boolean
  /** Current rename input value. */
  renameValue: string
  /** Keybinding string for the close/delete action. */
  closeKeybind: string

  onClick: () => void
  onDelete: (e: MouseEvent) => void
  onStartRename: (current: string) => void
  onRenameInput: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onRemoveStale: () => void
}

const MAX_SHORTCUT = 9

const hasStats = (s: WorktreeGitStats | undefined): s is WorktreeGitStats =>
  !!s && (s.files > 0 || s.additions > 0 || s.deletions > 0 || s.ahead > 0 || s.behind > 0)

export const WorktreeItem: Component<WorktreeItemProps> = (props) => {
  const { t } = useLanguage()
  const [hovered, setHovered] = createSignal(false)
  const [overClose, setOverClose] = createSignal(false)

  return (
    <>
      <Show when={props.groupStart}>
        <div class="am-wt-group-header">
          <Icon name="layers" size="small" />
          <span class="am-wt-group-label">{t("agentManager.worktree.versions", { count: props.groupSize })}</span>
        </div>
      </Show>
      <HoverCard
        openDelay={100}
        closeDelay={100}
        placement="right-start"
        gutter={8}
        open={hovered() && !overClose() && !props.pendingDelete}
        onOpenChange={(open) => setHovered(open)}
        trigger={
          <div
            class="am-worktree-item"
            classList={{
              "am-worktree-item-active": props.active,
              "am-worktree-pending-delete": props.pendingDelete,
              "am-wt-grouped": props.grouped,
              "am-wt-group-end": props.groupEnd,
            }}
            data-sidebar-id={props.worktree.id}
            onClick={() => props.onClick()}
          >
            <Show when={!props.busy && !props.working} fallback={<Spinner class="am-worktree-spinner" />}>
              <Icon name="branch" size="small" />
            </Show>
            <Show when={props.stale}>
              <Tooltip value={t("agentManager.worktree.staleTooltip")} placement="top" contentClass="am-tooltip-wrap">
                <span class="am-worktree-stale-badge">
                  <Icon name="warning" size="small" />
                </span>
              </Tooltip>
            </Show>
            <Show
              when={props.renaming}
              fallback={
                <span
                  class="am-worktree-branch"
                  onDblClick={(e) => {
                    e.stopPropagation()
                    props.onStartRename(props.label)
                  }}
                  title={t("agentManager.worktree.doubleClickRename")}
                >
                  {props.label}
                </span>
              }
            >
              <input
                class="am-worktree-rename-input"
                value={props.renameValue}
                onInput={(e) => props.onRenameInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    props.onCommitRename()
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    props.onCancelRename()
                  }
                }}
                onBlur={() => props.onCommitRename()}
                onClick={(e) => e.stopPropagation()}
                ref={(el) =>
                  requestAnimationFrame(() => {
                    el.focus()
                    el.select()
                  })
                }
              />
            </Show>
            <Show when={props.shortcut >= 2 && props.shortcut <= MAX_SHORTCUT}>
              <span class="am-shortcut-badge">
                {isMac ? "⌘" : "Ctrl+"}
                {props.shortcut}
              </span>
            </Show>
            <Show when={props.stats === undefined}>
              <div class="am-worktree-stats-skeleton">
                <div class="am-worktree-stats-skeleton-row" />
                <div class="am-worktree-stats-skeleton-row" style={{ width: "70%" }} />
              </div>
            </Show>
            <Show when={hasStats(props.stats)}>
              <div class="am-worktree-stats">
                <Show
                  when={props.stats!.additions > 0 || props.stats!.deletions > 0}
                  fallback={
                    <Show when={props.stats!.files > 0}>
                      <span class="am-stat-files">{props.stats!.files}f</span>
                    </Show>
                  }
                >
                  <div class="am-worktree-stats-row">
                    <Show when={props.stats!.additions > 0}>
                      <span class="am-stat-additions">+{props.stats!.additions}</span>
                    </Show>
                    <Show when={props.stats!.deletions > 0}>
                      <span class="am-stat-deletions">−{props.stats!.deletions}</span>
                    </Show>
                  </div>
                </Show>
                <Show when={props.stats!.ahead > 0 || props.stats!.behind > 0}>
                  <div class="am-worktree-stats-row">
                    <Show when={props.stats!.ahead > 0}>
                      <span class="am-worktree-commits">↑{props.stats!.ahead}</span>
                    </Show>
                    <Show when={props.stats!.behind > 0}>
                      <span class="am-worktree-behind">↓{props.stats!.behind}</span>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={props.pendingDelete && !props.busy}>
              <span class="am-worktree-delete-hint">{t("agentManager.worktree.confirmDelete")}</span>
            </Show>
            <Show when={!props.busy && !props.pendingDelete}>
              <div
                class="am-worktree-close"
                onMouseEnter={() => setOverClose(true)}
                onMouseLeave={() => setOverClose(false)}
              >
                <TooltipKeybind title={t("agentManager.worktree.delete")} keybind={props.closeKeybind} placement="top">
                  <IconButton
                    icon="trash"
                    size="small"
                    variant="ghost"
                    label={t("agentManager.worktree.delete")}
                    onClick={(e: MouseEvent) => props.onDelete(e)}
                  />
                </TooltipKeybind>
              </div>
            </Show>
          </div>
        }
      >
        <div class="am-hover-card">
          <div class="am-hover-card-header">
            <div>
              <div class="am-hover-card-label">{t("agentManager.hoverCard.branch")}</div>
              <div class="am-hover-card-branch">{props.worktree.branch}</div>
              <div class="am-hover-card-meta">{formatRelativeDate(props.worktree.createdAt)}</div>
            </div>
            <Show when={props.navHint}>
              <span class="am-hover-card-keybind">{props.navHint}</span>
            </Show>
          </div>
          <Show when={props.worktree.parentBranch}>
            <div class="am-hover-card-divider" />
            <div class="am-hover-card-row">
              <span class="am-hover-card-row-label">{t("agentManager.hoverCard.base")}</span>
              <span class="am-hover-card-row-value">
                {props.worktree.remote
                  ? `${props.worktree.remote}/${props.worktree.parentBranch}`
                  : props.worktree.parentBranch}
              </span>
            </div>
          </Show>
          <div class="am-hover-card-divider" />
          <div class="am-hover-card-row">
            <span class="am-hover-card-row-label">{t("agentManager.hoverCard.sessions")}</span>
            <span class="am-hover-card-row-value">{props.sessions}</span>
          </div>
          <Show when={props.stale}>
            <div class="am-hover-card-divider" />
            <div class="am-hover-card-row am-hover-card-row-stale">
              <span class="am-hover-card-row-label">{t("agentManager.worktree.stale")}</span>
              <span class="am-hover-card-row-value am-hover-card-stale-pill">
                <Icon name="warning" size="small" />
                {t("agentManager.worktree.stale")}
              </span>
            </div>
            <div class="am-hover-card-note">{t("agentManager.worktree.staleTooltip")}</div>
            <div class="am-hover-card-actions">
              <Button
                variant="ghost"
                size="small"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation()
                  props.onRemoveStale()
                }}
              >
                {t("agentManager.worktree.removeStale")}
              </Button>
            </div>
          </Show>
          <Show when={hasStats(props.stats)}>
            <div class="am-hover-card-divider" />
            <Show when={props.stats!.files > 0}>
              <div class="am-hover-card-row">
                <span class="am-hover-card-row-label">{t("agentManager.hoverCard.files")}</span>
                <span class="am-hover-card-row-value">{props.stats!.files}</span>
              </div>
            </Show>
            <Show when={props.stats!.additions > 0 || props.stats!.deletions > 0}>
              <div class="am-hover-card-row">
                <span class="am-hover-card-row-label">{t("agentManager.hoverCard.changes")}</span>
                <span class="am-hover-card-row-value am-hover-card-diff-stats">
                  <Show when={props.stats!.additions > 0}>
                    <span class="am-stat-additions">+{props.stats!.additions}</span>
                  </Show>
                  <Show when={props.stats!.deletions > 0}>
                    <span class="am-stat-deletions">−{props.stats!.deletions}</span>
                  </Show>
                </span>
              </div>
            </Show>
            <Show when={props.stats!.ahead > 0 || props.stats!.behind > 0}>
              <div class="am-hover-card-row">
                <span class="am-hover-card-row-label">{t("agentManager.hoverCard.commits")}</span>
                <span class="am-hover-card-row-value am-hover-card-diff-stats">
                  <Show when={props.stats!.ahead > 0}>
                    <span class="am-worktree-commits">↑{props.stats!.ahead}</span>
                  </Show>
                  <Show when={props.stats!.behind > 0}>
                    <span class="am-worktree-behind">↓{props.stats!.behind}</span>
                  </Show>
                </span>
              </div>
            </Show>
          </Show>
          <div class="am-hover-card-divider" />
          <div class="am-hover-card-hint">
            <Icon name="edit" size="small" />
            <span>{t("agentManager.worktree.doubleClickRename")}</span>
          </div>
        </div>
      </HoverCard>
    </>
  )
}
