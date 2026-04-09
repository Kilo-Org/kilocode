/**
 * Sidebar worktree item with inline delete confirmation, HoverCard, rename, and stats.
 * Extracted from AgentManagerApp for reuse and visual-regression testing via Storybook.
 */
import { Component, For, Show, createSignal } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { HoverCard } from "@kilocode/kilo-ui/hover-card"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { Button } from "@kilocode/kilo-ui/button"
import type { WorktreeState, WorktreeGitStats, PRStatus, SectionState } from "../src/types/messages"
import { colorCss } from "./section-colors"
import { useLanguage } from "../src/context/language"
import { formatRelativeDate } from "../src/utils/date"

import { parseBindingTokens } from "./keybind-tokens"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

interface WorktreeItemProps {
  worktree: WorktreeState
  /** Display label (resolved from label, first session title, or branch). */
  label: string
  /** Branch name shown as subtitle when it differs from the label. */
  subtitle?: string
  active: boolean
  pendingDelete: boolean
  busy: boolean
  /** Whether an agent session on this worktree is actively working (shows spinner instead of branch icon). */
  working: boolean
  stale: boolean
  /** 1-indexed shortcut number shown as ⌘2, ⌘3, etc. Pass 0, >9, or undefined to hide. */
  shortcut?: number
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
  /** Keybinding string for the open-in-vscode action. */
  openKeybind: string
  /** PR status for this worktree's branch, or null if no PR. */
  pr?: PRStatus | null
  /** Callback when the PR badge is clicked. */
  onOpenPR?: () => void
  /** Available sections for the "Move to Section" submenu. */
  sections?: SectionState[]
  /** ID of the section this worktree currently belongs to (for disabling current item). */
  currentSectionId?: string
  /** Move this worktree to a section (or null for ungrouped). */
  onMoveToSection?: (sectionId: string | null) => void
  /** Move this worktree to a new section. */
  onMoveToNewSection?: () => void

  onClick: () => void
  onDelete: (e: MouseEvent) => void
  onStartRename: (current: string) => void
  onRenameInput: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onRemoveStale: () => void
  onCopyPath: () => void
  onOpen: () => void
}

const MAX_SHORTCUT = 9

const hasStats = (s: WorktreeGitStats | undefined): s is WorktreeGitStats =>
  !!s && (s.files > 0 || s.additions > 0 || s.deletions > 0 || s.ahead > 0 || s.behind > 0)

/** Returns the accent color for a PR badge based on state priority. */
export function prAccentColor(pr: PRStatus): string {
  if (pr.state === "draft") return "var(--text-weaker)"
  if (pr.state === "merged") return "#a78bfa"
  if (pr.state === "closed") return "#f87171"
  if (pr.checks.status === "failure") return "#ef4444"
  if (pr.review === "changes_requested") return "#fbbf24"
  if (pr.checks.status === "pending") return "#fbbf24"
  return "#34d399"
}

function prStateLabel(state: PRStatus["state"]): string {
  if (state === "draft") return "Draft"
  if (state === "merged") return "Merged"
  if (state === "closed") return "Closed"
  return "Open"
}

function reviewLabel(review: string): string {
  if (review === "approved") return "Approved"
  if (review === "changes_requested") return "Changes Requested"
  return "Pending"
}

export const WorktreeItem: Component<WorktreeItemProps> = (props) => {
  const { t } = useLanguage()
  const [hovered, setHovered] = createSignal(false)
  const [overClose, setOverClose] = createSignal(false)

  const handleOpenPR = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    props.onOpenPR?.()
  }

  return (
    <>
      <Show when={props.groupStart}>
        <div class="am-wt-group-header">
          <Icon name="layers" size="small" />
          <span class="am-wt-group-label">{t("agentManager.worktree.versions", { count: props.groupSize })}</span>
        </div>
      </Show>
      <ContextMenu>
        <HoverCard
          openDelay={100}
          closeDelay={100}
          placement="right-start"
          gutter={8}
          open={hovered() && !overClose() && !props.pendingDelete}
          onOpenChange={(open) => setHovered(open)}
          trigger={
            <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
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
                <div class="am-wt-icon">
                  <Show when={!props.busy && !props.working} fallback={<Spinner class="am-worktree-spinner" />}>
                    <Icon name="branch" size="small" />
                  </Show>
                </div>
                <div class="am-wt-content">
                  {/* Row 1: label + stale badge + stats/hover-actions overlay */}
                  <div class="am-wt-row1">
                    <Show when={props.stale}>
                      <Tooltip
                        value={t("agentManager.worktree.staleTooltip")}
                        placement="top"
                        contentClass="am-tooltip-wrap"
                      >
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
                          requestAnimationFrame(() =>
                            requestAnimationFrame(() => {
                              el.focus()
                              el.select()
                            }),
                          )
                        }
                      />
                    </Show>
                    {/* Grid cell: stats visible by default, hover actions on top */}
                    <div class="am-wt-actions-cell">
                      <Show when={props.stats === undefined}>
                        <div class="am-worktree-stats-skeleton">
                          <div class="am-worktree-stats-skeleton-row" />
                        </div>
                      </Show>
                      <Show when={hasStats(props.stats)}>
                        <div class="am-worktree-stats">
                          <Show when={props.stats!.behind > 0}>
                            <span class="am-worktree-behind">↓{props.stats!.behind}</span>
                          </Show>
                          <Show when={props.stats!.ahead > 0}>
                            <span class="am-worktree-commits">↑{props.stats!.ahead}</span>
                          </Show>
                          <Show
                            when={props.stats!.additions > 0 || props.stats!.deletions > 0}
                            fallback={
                              <Show when={props.stats!.files > 0}>
                                <span class="am-stat-files">{props.stats!.files}f</span>
                              </Show>
                            }
                          >
                            <Show when={props.stats!.additions > 0}>
                              <span class="am-stat-additions">+{props.stats!.additions}</span>
                            </Show>
                            <Show when={props.stats!.deletions > 0}>
                              <span class="am-stat-deletions">−{props.stats!.deletions}</span>
                            </Show>
                          </Show>
                        </div>
                      </Show>
                      <Show when={props.pendingDelete && !props.busy}>
                        <span class="am-worktree-delete-hint">{t("agentManager.worktree.confirmDelete")}</span>
                      </Show>
                      <div class="am-wt-hover-actions">
                        <Show
                          when={props.shortcut !== undefined && props.shortcut >= 2 && props.shortcut <= MAX_SHORTCUT}
                        >
                          <span class="am-shortcut-badge">
                            {isMac ? "⌘" : "Ctrl+"}
                            {props.shortcut}
                          </span>
                        </Show>
                        <Show when={!props.busy && !props.pendingDelete}>
                          <div
                            class="am-worktree-close"
                            onMouseEnter={() => setOverClose(true)}
                            onMouseLeave={() => setOverClose(false)}
                          >
                            <TooltipKeybind
                              title={t("agentManager.worktree.delete")}
                              keybind={props.closeKeybind}
                              placement="top"
                            >
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
                    </div>
                  </div>
                  {/* Row 2: branch subtitle + PR badge */}
                  <div class="am-wt-row2">
                    <Show when={props.subtitle}>
                      <span class="am-worktree-subtitle">{props.subtitle}</span>
                    </Show>
                    <Show
                      when={props.pr}
                      fallback={
                        <Show when={props.stats === undefined}>
                          <div class="am-pr-badge-skeleton" />
                        </Show>
                      }
                    >
                      {(pr) => {
                        const accent = () => prAccentColor(pr())
                        return (
                          <span
                            class="am-pr-badge"
                            style={{ "--pr-accent": accent() }}
                            data-pending={pr().state === "open" && pr().checks.status === "pending" ? "" : undefined}
                            onClick={handleOpenPR}
                          >
                            <Icon name={pr().review === "approved" ? "check-small" : "branch"} size="small" />
                            <span class="am-pr-badge-number">#{pr().number}</span>
                          </span>
                        )
                      }}
                    </Show>
                  </div>
                </div>
              </div>
            </ContextMenu.Trigger>
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
            <Show when={props.pr}>
              {(pr) => (
                <>
                  <div class="am-hover-card-divider" />
                  <div class="am-hover-card-row">
                    <span class="am-hover-card-row-label">PR #{pr().number}</span>
                    <span class="am-hover-card-row-value">
                      <span class="am-pr-link" onClick={handleOpenPR}>
                        <Icon name="link" size="small" />
                      </span>
                      {prStateLabel(pr().state)}
                    </span>
                  </div>
                  <Show when={pr().review}>
                    <div class="am-hover-card-row">
                      <span class="am-hover-card-row-label">Review</span>
                      <span class="am-hover-card-row-value">{reviewLabel(pr().review!)}</span>
                    </div>
                  </Show>
                  <div class="am-hover-card-row">
                    <span class="am-hover-card-row-label">Checks</span>
                    <span class="am-hover-card-row-value">
                      {pr().checks.passed}/{pr().checks.total} passed
                    </span>
                  </div>
                </>
              )}
            </Show>
            <div class="am-hover-card-divider" />
            <div class="am-hover-card-hint">
              <Icon name="edit" size="small" />
              <span>{t("agentManager.worktree.doubleClickRename")}</span>
            </div>
          </div>
        </HoverCard>
        <ContextMenu.Portal>
          <ContextMenu.Content class="am-ctx-menu">
            <ContextMenu.Item onSelect={() => props.onStartRename(props.label)}>
              <Icon name="edit" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.worktree.rename")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => props.onDelete(new MouseEvent("click"))}>
              <Icon name="trash" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.worktree.delete")}</ContextMenu.ItemLabel>
              <Show when={props.closeKeybind}>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(props.closeKeybind).map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </Show>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => props.onOpen()}>
              <Icon name="open-file" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.worktree.openInVscode")}</ContextMenu.ItemLabel>
              <Show when={props.openKeybind}>
                <span class="am-menu-shortcut">
                  {parseBindingTokens(props.openKeybind).map((token) => (
                    <kbd class="am-menu-key">{token}</kbd>
                  ))}
                </span>
              </Show>
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => props.onCopyPath()}>
              <Icon name="copy" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.worktree.copyPath")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => props.onMoveToNewSection?.()}>
              <Icon name="plus" size="small" />
              <ContextMenu.ItemLabel>{t("agentManager.worktree.newSection")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <Show when={props.sections && props.sections.length > 0}>
              <ContextMenu.Separator />
              <ContextMenu.Item onSelect={() => props.onMoveToSection?.(null)}>
                <Show when={!props.currentSectionId}>
                  <Icon name="check" size="small" />
                </Show>
                <ContextMenu.ItemLabel>{t("agentManager.worktree.ungrouped")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <For each={props.sections}>
                {(sec) => (
                  <ContextMenu.Item onSelect={() => props.onMoveToSection?.(sec.id)}>
                    <Show
                      when={props.currentSectionId === sec.id}
                      fallback={
                        <span
                          class="am-color-swatch am-color-swatch-sm"
                          style={{ background: colorCss(sec.color) ?? "var(--vscode-panel-border)" }}
                        />
                      }
                    >
                      <Icon name="check" size="small" />
                    </Show>
                    <ContextMenu.ItemLabel>{sec.name}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                )}
              </For>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </>
  )
}
