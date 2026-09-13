import { For, Show, createMemo, createSignal, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import type {
  LocalGitStats,
  ManagedSessionState,
  PRStatus,
  RunStatus,
  SectionState,
  WorktreeGitStats,
  WorktreeState,
} from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import type { SidebarSearchItem } from "./sidebar-search"
import { LOCAL, adjacentHint } from "./navigate"
import { applyTabOrder, reorderTabs } from "./tab-order"
import { buildTopLevelItems, isGroupEnd, isGroupStart, isGrouped } from "./section-helpers"
import { createWorktreeCompletion } from "./worktree-completion"
import { sectionAwareDetector } from "./section-dnd"
import { ConstrainDragXAxis } from "./constrain-drag-x"
import { useVSCode } from "../src/context/vscode"
import SectionHeader from "./SectionHeader"
import { SidebarSectionHeader } from "./SidebarSectionHeader"
import { WorktreeItem } from "./WorktreeItem"
import { useBaseUpdate } from "./update-from-base"
import { WorktreeSectionActions } from "./WorktreeSectionActions"
import { StatsSkeleton, WorktreeSkeleton } from "./Skeleton"
import type { SidebarSearchMenuRef } from "./SidebarSearchMenu"
import { LocalActivity } from "../src/components/shared/ActivityIcon"
import { label, type Activity } from "../src/utils/session-activity"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** Everything the legacy single-project sidebar body reads from the app. */
export interface SidebarBodyProps {
  t: LanguageContextValue["t"]
  projectId?: string
  selection: () => string | null
  currentSessionID: () => string | undefined
  selectLocal: () => void
  selectWorktree: (id: string) => void
  onOpenComments?: (id: string) => void
  onOpenPR?: (id: string) => void
  activityFor: (id: string | null) => Activity
  repoBranch: () => string | undefined
  localStats: () => LocalGitStats | undefined
  search: { items: () => SidebarSearchItem[]; current: () => SidebarSearchItem | undefined }
  bindings: () => Record<string, string>
  defaultBranch: () => string
  isGitRepo: () => boolean
  loaded: () => boolean
  worktreesLoaded: () => boolean
  sessionsLoaded: () => boolean
  onSearchRef: (ref: SidebarSearchMenuRef | undefined) => void
  onSearchSelect: (item: SidebarSearchItem) => void
  onCreateWorktree: () => void
  onNewWorktree: () => void
  onNewSection: () => void
  onShortcuts: () => void
  onHistory: () => void
  sections: () => SectionState[]
  sortedWorktrees: () => WorktreeState[]
  sidebarOrder: () => { id: string }[]
  sidebarWorktreeOrder: () => string[]
  setSidebarWorktreeOrder: (fn: (prev: string[]) => string[]) => void
  draggingWorktree: () => string | undefined
  setDraggingWorktree: (id: string | undefined) => void
  moveToSection: (ids: string[], sectionId: string | null) => void
  moveSection: (id: string, dir: -1 | 1) => void
  renamingSection: () => string | null
  setRenamingSection: (id: string | null) => void
  managedSessions: () => ManagedSessionState[]
  worktreeLabel: (wt: WorktreeState) => string
  worktreeSubtitle: (wt: WorktreeState) => string | undefined
  pendingDelete: () => string | null
  busy: (id: string) => boolean
  blocked: (id: string) => boolean
  isStaleWorktree: (id: string) => boolean
  shortcutMap: () => Map<string, number>
  worktreeStats: () => Record<string, WorktreeGitStats>
  prStatuses: () => Record<string, PRStatus | null>
  runStatuses: () => Record<string, RunStatus>
  cancelPendingDelete: () => void
  handleDeleteWorktree: (id: string, e: MouseEvent) => void
  confirmRemoveStaleWorktree: (id: string) => void
  track: (event: string, source: string, action: () => void) => () => void
}

/** Legacy single-project sidebar body: local repo, worktrees, unassigned sessions. */
export const SidebarBody: Component<SidebarBodyProps> = (props) => {
  const completion = createWorktreeCompletion(props.sortedWorktrees, () => props.projectId, props.worktreeLabel)
  const sorted = completion.rows
  const ungrouped = createMemo(() => sorted().filter((wt) => !wt.sectionId))
  const top = createMemo(() =>
    buildTopLevelItems(props.sections(), ungrouped(), sorted(), props.sidebarWorktreeOrder()),
  )
  const vscode = useVSCode()
  const updateBase = useBaseUpdate()
  const localState = () => props.activityFor(null)

  return (
    <>
      {/* Local repo item */}
      <button
        class={`am-local-item ${props.selection() === LOCAL ? "am-local-item-active" : ""}`}
        data-sidebar-id="local"
        onClick={() => props.selectLocal()}
      >
        <LocalActivity state={localState()} label={props.t(label(localState()))} />
        <div class="am-local-text">
          <span class="am-local-label">{props.t("agentManager.local")}</span>
          <Show when={props.repoBranch()}>
            <span class="am-local-branch">{props.repoBranch()}</span>
          </Show>
        </div>
        <div class="am-wt-actions-cell">
          <Show when={props.localStats() === undefined}>
            <StatsSkeleton />
          </Show>
          <Show
            when={
              props.localStats() &&
              (props.localStats()!.files > 0 ||
                props.localStats()!.additions > 0 ||
                props.localStats()!.deletions > 0 ||
                props.localStats()!.ahead > 0 ||
                props.localStats()!.behind > 0)
            }
          >
            <div class="am-worktree-stats">
              <Show
                when={props.localStats()!.additions > 0 || props.localStats()!.deletions > 0}
                fallback={
                  <Show when={props.localStats()!.files > 0}>
                    <span class="am-stat-files">{props.localStats()!.files}f</span>
                  </Show>
                }
              >
                <div class="am-worktree-stats-row">
                  <Show when={props.localStats()!.additions > 0}>
                    <span class="am-stat-additions">+{props.localStats()!.additions}</span>
                  </Show>
                  <Show when={props.localStats()!.deletions > 0}>
                    <span class="am-stat-deletions">
                      {"−"}
                      {props.localStats()!.deletions}
                    </span>
                  </Show>
                </div>
              </Show>
              <Show when={props.localStats()!.ahead > 0 || props.localStats()!.behind > 0}>
                <div class="am-worktree-stats-row">
                  <Show when={props.localStats()!.ahead > 0}>
                    <span class="am-worktree-commits">
                      {"↑"}
                      {props.localStats()!.ahead}
                    </span>
                  </Show>
                  <Show when={props.localStats()!.behind > 0}>
                    <span class="am-worktree-behind">
                      {"↓"}
                      {props.localStats()!.behind}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
          <div class="am-wt-hover-actions">
            <span class="am-shortcut-badge">{isMac ? "⌘" : "Ctrl+"}1</span>
          </div>
        </div>
      </button>

      {/* WORKTREES section */}
      <div class="am-section am-section-grow">
        <SidebarSectionHeader
          class="am-section-header"
          label={<span class="am-section-label">{props.t("agentManager.section.worktrees")}</span>}
          actions={
            <WorktreeSectionActions
              items={props.search.items}
              current={props.search.current}
              bindings={props.bindings()}
              branch={props.defaultBranch()}
              git={props.isGitRepo()}
              loaded={props.loaded()}
              t={props.t}
              onRef={(value) => props.onSearchRef(value)}
              onSelect={props.onSearchSelect}
              onCreate={props.onCreateWorktree}
              onNew={props.onNewWorktree}
              onSection={props.onNewSection}
              onShortcuts={props.onShortcuts}
              onHistory={props.onHistory}
              onSettings={() =>
                vscode.postMessage({ type: "openSettingsPanel", tab: "agentManager", projectId: props.projectId })
              }
            />
          }
        />
        <div class="am-worktree-list">
          <Show when={props.worktreesLoaded() && props.sessionsLoaded()} fallback={<WorktreeSkeleton />}>
            <Show when={!props.isGitRepo()}>
              <div class="am-not-git-notice">
                <Icon name="warning" size="small" />
                <span>{props.t("agentManager.notGitRepo")}</span>
              </div>
            </Show>
            <Show when={props.isGitRepo()}>
              {(() => {
                const [renamingWt, setRenamingWt] = createSignal<string | null>(null)
                const [renameValue, setRenameValue] = createSignal("")

                const startRename = (wtId: string, current: string) => {
                  setRenamingWt(wtId)
                  setRenameValue(current)
                }

                let cancelled = false

                const commitRename = (wtId: string) => {
                  if (cancelled) {
                    cancelled = false
                    return
                  }
                  const value = renameValue().trim()
                  setRenamingWt(null)
                  if (!value) return
                  vscode.postMessage({ type: "agentManager.renameWorktree", worktreeId: wtId, label: value })
                }

                const cancelRename = () => {
                  cancelled = true
                  setRenamingWt(null)
                }

                const hasSections = createMemo(() => props.sections().length > 0)
                const wtIds = createMemo(() => sorted().map((wt) => wt.id))
                const secIds = createMemo(() => new Set(props.sections().map((s) => s.id)))
                const home = () => new Map(sorted().map((w) => [w.id, w.sectionId] as const))
                const sectionAware = sectionAwareDetector(secIds, home)

                const onWtDragStart = (event: DragEvent) => {
                  const id = event.draggable?.id
                  if (typeof id === "string") props.setDraggingWorktree(id)
                  document.body.classList.add("am-wt-dragging-active")
                }
                const onWtDragOver = (event: DragEvent) => {
                  const from = event.draggable?.id
                  const to = event.droppable?.id
                  if (typeof from !== "string" || typeof to !== "string") return
                  if (secIds().has(to)) return
                  props.setSidebarWorktreeOrder((prev) => {
                    const cur = applyTabOrder(
                      sorted().map((w) => ({ id: w.id })),
                      prev,
                    ).map((item: { id: string }) => item.id)
                    return reorderTabs(cur, from, to) ?? prev
                  })
                }
                const onWtDragEnd = (event: DragEvent) => {
                  const from = event.draggable?.id
                  const to = event.droppable?.id
                  props.setDraggingWorktree(undefined)
                  document.body.classList.remove("am-wt-dragging-active")
                  if (typeof from === "string" && typeof to === "string" && secIds().has(to)) {
                    props.moveToSection([from], to)
                    return
                  }
                  vscode.postMessage({ type: "agentManager.setWorktreeOrder", order: props.sidebarWorktreeOrder() })
                }

                return (
                  <DragDropProvider
                    onDragStart={onWtDragStart}
                    onDragEnd={onWtDragEnd}
                    onDragOver={onWtDragOver}
                    collisionDetector={sectionAware}
                  >
                    <DragDropSensors />
                    <ConstrainDragXAxis />
                    <SortableProvider ids={wtIds()}>
                      {(() => {
                        const renderWt = (wt: WorktreeState, idx: () => number, list?: WorktreeState[]) => {
                          const wtSessions = createMemo(() =>
                            props.managedSessions().filter((ms) => ms.worktreeId === wt.id),
                          )
                          const navHint = () =>
                            adjacentHint(
                              wt.id,
                              props.selection() ?? props.currentSessionID() ?? "",
                              props.sidebarOrder().map((f) => f.id),
                              props.bindings().previousSession ?? "",
                              props.bindings().nextSession ?? "",
                            )
                          const groupSize = () =>
                            !wt.groupId ? 0 : sorted().filter((w) => w.groupId === wt.groupId).length
                          const sortable = createSortable(wt.id)
                          void sortable
                          return (
                            <div
                              use:sortable
                              class={`am-wt-sortable ${sortable.isActiveDraggable ? "am-wt-dragging" : ""}`}
                            >
                              <WorktreeItem
                                completed={completion.completed(wt.id)}
                                onCompletionEnd={() => completion.release(wt.id)}
                                worktree={wt}
                                label={props.worktreeLabel(wt)}
                                subtitle={props.worktreeSubtitle(wt)}
                                active={props.selection() === wt.id}
                                pendingDelete={props.pendingDelete() === wt.id}
                                busy={props.busy(wt.id)}
                                activity={props.activityFor(wt.id)}
                                blocked={props.blocked(wt.id)}
                                stale={props.isStaleWorktree(wt.id)}
                                shortcut={props.shortcutMap().get(wt.id)}
                                stats={props.worktreeStats()[wt.id]}
                                navHint={navHint()}
                                sessions={wtSessions().length}
                                grouped={isGrouped(wt)}
                                groupStart={isGroupStart(wt, idx(), list ?? sorted())}
                                groupEnd={isGroupEnd(wt, idx(), list ?? sorted())}
                                groupSize={groupSize()}
                                renaming={renamingWt() === wt.id}
                                renameValue={renameValue()}
                                closeKeybind={props.bindings().closeWorktree ?? ""}
                                openKeybind={props.bindings().openWorktree ?? ""}
                                pr={
                                  props.prStatuses()[wt.id] !== undefined
                                    ? (props.prStatuses()[wt.id] ?? undefined)
                                    : undefined
                                }
                                runStatus={props.runStatuses()[wt.id]}
                                onOpenComments={() => props.onOpenComments?.(wt.id)}
                                onOpenPR={props.track("open_pull_request", "worktree_menu", () =>
                                  props.onOpenPR?.(wt.id),
                                )}
                                sections={props.sections()}
                                currentSectionId={wt.sectionId}
                                onMoveToSection={(secId) => props.moveToSection([wt.id], secId)}
                                onMoveToNewSection={props.track("new_section", "worktree_menu", () =>
                                  props.onNewSection(),
                                )}
                                onClick={() => props.selectWorktree(wt.id)}
                                onCancelDelete={props.cancelPendingDelete}
                                onDelete={(e) => props.handleDeleteWorktree(wt.id, e)}
                                onStartRename={(current) => startRename(wt.id, current)}
                                onRenameInput={(v) => setRenameValue(v)}
                                onCommitRename={() => commitRename(wt.id)}
                                onCancelRename={cancelRename}
                                onRemoveStale={() => props.confirmRemoveStaleWorktree(wt.id)}
                                onUpdateBase={() =>
                                  updateBase(
                                    wt.id,
                                    props.projectId,
                                    wtSessions().find((item) => item.id === props.currentSessionID())?.id,
                                  )
                                }
                                onCopyPath={() => navigator.clipboard.writeText(wt.path)}
                                onOpen={props.track("open_worktree_window", "worktree_menu", () =>
                                  vscode.postMessage({ type: "agentManager.openWorktree", worktreeId: wt.id }),
                                )}
                              />
                            </div>
                          )
                        }
                        if (hasSections()) {
                          const post = vscode.postMessage.bind(vscode)
                          return (
                            <For each={top()}>
                              {(item, idx) => {
                                if (item.kind === "section") {
                                  const sec = item.section
                                  const members = createMemo(() => sorted().filter((wt) => wt.sectionId === sec.id))
                                  return (
                                    <SectionHeader
                                      section={sec}
                                      count={members().length}
                                      autoRename={props.renamingSection() === sec.id}
                                      onRenameEnd={() => props.setRenamingSection(null)}
                                      onToggle={() =>
                                        post({ type: "agentManager.toggleSectionCollapsed", sectionId: sec.id })
                                      }
                                      onRename={(name) =>
                                        post({ type: "agentManager.renameSection", sectionId: sec.id, name })
                                      }
                                      onDelete={() => post({ type: "agentManager.deleteSection", sectionId: sec.id })}
                                      onSetColor={(color) =>
                                        post({ type: "agentManager.setSectionColor", sectionId: sec.id, color })
                                      }
                                      isFirst={idx() === 0}
                                      isLast={idx() === top().length - 1}
                                      onMoveUp={() => props.moveSection(sec.id, -1)}
                                      onMoveDown={() => props.moveSection(sec.id, 1)}
                                    >
                                      <Show when={!sec.collapsed}>
                                        <div class="am-section-group-body">
                                          <For each={members()}>{(wt, wtIdx) => renderWt(wt, wtIdx, members())}</For>
                                        </div>
                                      </Show>
                                    </SectionHeader>
                                  )
                                }
                                const ug = ungrouped()
                                const wtIdx = () => ug.indexOf(item.wt)
                                return renderWt(item.wt, wtIdx, ug)
                              }}
                            </For>
                          )
                        }
                        return <For each={sorted()}>{(wt, idx) => renderWt(wt, idx)}</For>
                      })()}
                    </SortableProvider>
                    <DragOverlay>
                      {(() => {
                        const wt = sorted().find((w) => w.id === props.draggingWorktree())
                        if (!wt) return null
                        return (
                          <div class="am-wt-overlay">
                            <Icon name="branch" size="small" />
                            <span>{props.worktreeLabel(wt)}</span>
                          </div>
                        )
                      })()}
                    </DragOverlay>
                  </DragDropProvider>
                )
              })()}
              <Show when={sorted().length === 0}>
                <button class="am-worktree-create" onClick={props.onNewWorktree}>
                  <Icon name="plus" size="small" />
                  <span>{props.t("agentManager.worktree.new")}</span>
                </button>
              </Show>
            </Show>
          </Show>
        </div>
      </div>
    </>
  )
}
