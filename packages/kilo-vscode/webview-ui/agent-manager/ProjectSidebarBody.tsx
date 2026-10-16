import { For, Show, createMemo, createSignal, onCleanup, type Component } from "solid-js"
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
  AgentManagerStateMessage,
  AgentProjectSnapshot,
  LocalGitStats,
  PRStatus,
  ProjectSessionInfo,
  WorktreeState,
  WorktreeGitStats,
} from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import { LocalActivity } from "../src/components/shared/ActivityIcon"
import { label, type Activity } from "../src/utils/session-activity"
import { useVSCode } from "../src/context/vscode"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import SectionHeader from "./SectionHeader"
import { OrphanNotice } from "./orphans/OrphanNotice"
import { OrphanDialog } from "./orphans/OrphanDialog"
import { WorktreeItem, actionable } from "./WorktreeItem"
import { useBaseUpdate } from "./update-from-base"
import { StatsSkeleton, WorktreeSkeleton } from "./Skeleton"
import { applyTabOrder, firstOrderedTitle, reorderTabs } from "./tab-order"
import { buildTopLevelItems, sortWorktrees, isGroupEnd, isGroupStart, isGrouped } from "./section-helpers"
import type { WorktreeDelete } from "./worktree-delete"
import { outsideSidebar, sectionAwareDetector } from "./section-dnd"
import { ConstrainDragXAxis } from "./constrain-drag-x"
import type { ProjectStore } from "./project/store"
import { projectSidebarOrder, projectWorktreeRow } from "./project-local-navigation"
import { rootSessions } from "./project/session-filter"
import { createWorktreeCompletion } from "./worktree-completion"
import { worktreeDropReference } from "./worktree-references"
import { beginPromptMentionDrop, endPromptMentionDrop } from "../src/utils/prompt-mention-drop"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

interface Props {
  project: AgentProjectSnapshot
  state?: AgentManagerStateMessage
  store: ProjectStore
  deletion: WorktreeDelete
  busy: (id: string) => boolean
  blocked: (id: string) => boolean
  activityFor: (worktreeId: string | null) => Activity
  stats?: Record<string, WorktreeGitStats>
  local?: LocalGitStats
  prs?: Record<string, PRStatus | null>
  sessions?: ProjectSessionInfo[]
  selectedProject?: string
  selection?: string
  currentSessionID?: () => string | undefined
  bindings: Record<string, string>
  t: LanguageContextValue["t"]
  onSelectLocal: (projectId: string) => void
  onSelectWorktree: (projectId: string, worktreeId: string) => void
  onOpenComments?: (projectId: string, worktreeId: string) => void
  onOpenPR?: (projectId: string, worktreeId: string) => void
  onCreateSection: (worktreeIds?: string[]) => void
  renamingSection: () => string | undefined
  onRenameEnd: () => void
  shortcutMap?: () => Map<string, number>
}

/** Permanent real sidebar body for one expanded project. */
export const ProjectSidebarBody: Component<Props> = (props) => {
  const vscode = useVSCode()
  const dialog = useDialog()
  const updateBase = useBaseUpdate()
  const store = props.store
  const [renaming, setRenaming] = createSignal<string>()
  const [dragging, setDragging] = createSignal<string>()
  const [dragOrigin, setDragOrigin] = createSignal<string[]>()
  const [name, setName] = createSignal("")
  const state = () => props.state
  const sessions = (worktreeId: string | null) => rootSessions(props.sessions ?? [], worktreeId)
  const active = () => props.selectedProject === props.project.id
  const runs = () => store.runStatuses()
  const sections = () => store.sections()
  const worktrees = () => store.worktrees()
  const order = () => store.worktreeOrder()
  const completion = createWorktreeCompletion(
    () => sortWorktrees(worktrees(), order()),
    () => props.project.id,
    (wt) => wt.label || firstOrderedTitle(sessions(wt.id), store.tabOrder()[wt.id], wt.branch),
  )
  const sorted = completion.rows
  const pinned = createMemo(() => sorted().filter((wt) => wt.pinned))
  // Pinned members render in the pinned block, so the section body uses this list.
  const members = (sectionId: string) => sorted().filter((wt) => wt.sectionId === sectionId && !wt.pinned)
  // Membership keeps pinned members: pinning does not remove a worktree from its section.
  const memberCount = (sectionId: string) => sorted().filter((wt) => wt.sectionId === sectionId).length
  const ungrouped = createMemo(() => sorted().filter((wt) => !wt.sectionId && !wt.pinned))
  const top = createMemo(() => buildTopLevelItems(sections(), ungrouped(), sorted(), order()))
  const sidebarOrder = createMemo(() => projectSidebarOrder(top(), sorted(), sections(), members))
  const post = (message: Record<string, unknown>) =>
    vscode.postMessage({ ...message, projectId: props.project.id } as never)
  const openOrphanDialog = () =>
    dialog.show(() => (
      <OrphanDialog
        orphans={store.orphanDirectories()}
        onReveal={(path) => post({ type: "agentManager.revealPath", path })}
        onDelete={(paths) => {
          post({ type: "agentManager.cleanOrphanDirectories", paths })
          dialog.close()
        }}
        onClose={() => dialog.close()}
      />
    ))
  const localState = () => props.activityFor(null)

  const row = (id: string) =>
    projectWorktreeRow({
      projectId: props.project.id,
      activeProjectId: props.selectedProject,
      worktreeId: id,
      activeId: props.selection ?? props.currentSessionID?.(),
      flatIds: sidebarOrder(),
      bindings: props.bindings,
      shortcuts: props.shortcutMap?.(),
    })

  const scope = (kind: "section" | "worktree", id: string) => `${props.project.id}:${kind}:${id}`
  const parse = (kind: "section" | "worktree", value: unknown) => {
    if (typeof value !== "string") return
    const prefix = `${props.project.id}:${kind}:`
    return value.startsWith(prefix) ? value.slice(prefix.length) : undefined
  }

  const worktreeIds = createMemo(() => new Set(worktrees().map((wt) => wt.id)))
  const sectionIds = createMemo(() => new Set(sections().map((section) => scope("section", section.id))))
  const home = createMemo(
    () =>
      new Map(
        worktrees().map(
          (wt) => [scope("worktree", wt.id), wt.sectionId ? scope("section", wt.sectionId) : undefined] as const,
        ),
      ),
  )
  const detector = sectionAwareDetector(sectionIds, home)
  const dragIds = createMemo(() => sorted().map((wt) => scope("worktree", wt.id)))

  const onDragStart = (event: DragEvent) => {
    const id = parse("worktree", event.draggable?.id)
    if (!id || !worktreeIds().has(id)) return
    setDragging(id)
    setDragOrigin(order())
    const wt = worktrees().find((item) => item.id === id)
    if (wt) {
      beginPromptMentionDrop({
        kind: "worktree",
        worktree: worktreeDropReference(
          wt,
          wt.label || firstOrderedTitle(sessions(wt.id), store.tabOrder()[wt.id], wt.branch),
          sessions(wt.id).map((session) => ({ id: session.id })),
          wt.id === props.selection || store.staleWorktreeIds().has(wt.id) || store.busy().has(wt.id),
        ),
      })
    }
    document.body.classList.add("am-wt-dragging-active")
  }

  const onDragOver = (event: DragEvent) => {
    // Once the card leaves the sidebar it is on its way to the prompt, so stop
    // reordering the list under it.
    if (outsideSidebar(event.draggable)) return
    const from = parse("worktree", event.draggable?.id)
    const to = parse("worktree", event.droppable?.id)
    if (!from || !to || !worktreeIds().has(from) || !worktreeIds().has(to)) return
    // Pinned and unpinned worktrees render in separate blocks, so only reorder inside one block.
    const pin = (id: string) => worktrees().find((wt) => wt.id === id)?.pinned === true
    if (pin(from) !== pin(to)) return
    store.setWorktreeOrder((previous) => {
      const current = applyTabOrder(
        sorted().map((wt) => ({ id: wt.id })),
        previous,
      ).map((item) => item.id)
      return reorderTabs(current, from, to) ?? previous
    })
  }

  const onDragEnd = (event: DragEvent) => {
    const handled = endPromptMentionDrop()
    const from = parse("worktree", event.draggable?.id)
    const section = parse("section", event.droppable?.id)
    const to = parse("worktree", event.droppable?.id)
    setDragging(undefined)
    const origin = dragOrigin()
    setDragOrigin(undefined)
    document.body.classList.remove("am-wt-dragging-active")
    // A drop on the prompt inserts a mention. Do not also move the worktree to
    // whatever section happens to be under the pointer. Both this path and an
    // outside release undo the reorder applied while passing over sibling rows.
    if (handled || outsideSidebar(event.draggable)) {
      if (origin) store.setWorktreeOrder(origin)
      return
    }
    if (!from || !worktreeIds().has(from)) {
      if (origin) store.setWorktreeOrder(origin)
      return
    }
    if (section && sections().some((item) => item.id === section)) {
      post({ type: "agentManager.moveToSection", worktreeIds: [from], sectionId: section })
      const wt = worktrees().find((item) => item.id === from)
      if (wt) unpinForMove(wt, section)
      return
    }
    if (!to || !worktreeIds().has(to)) {
      if (origin) store.setWorktreeOrder(origin)
      return
    }
    post({ type: "agentManager.setWorktreeOrder", order: order() })
  }

  onCleanup(() => document.body.classList.remove("am-wt-dragging-active"))

  // Escape unmounts the focused rename input, which fires a synchronous blur
  // that would re-commit the cancelled value; this flag swallows that blur.
  let cancelled = false
  const commitRename = (worktreeId: string) => {
    if (cancelled) {
      cancelled = false
      return
    }
    const label = name().trim()
    setRenaming(undefined)
    if (label) post({ type: "agentManager.renameWorktree", worktreeId, label })
  }
  const cancelRename = () => {
    cancelled = true
    setRenaming(undefined)
  }

  // Pinning keeps the section, so an explicit move into a different section must unpin to be
  // visible. A no-op move (the current section, or Ungrouped when already ungrouped) leaves the pin.
  const unpinForMove = (wt: WorktreeState, sectionId: string | null) => {
    if (!wt.pinned) return
    if ((sectionId ?? null) === (wt.sectionId ?? null)) return
    post({ type: "agentManager.setWorktreePinned", worktreeId: wt.id, pinned: false })
  }
  // Creating a section always moves the worktree, so it always clears the pin.
  const unpin = (wt: WorktreeState) => {
    if (wt.pinned) post({ type: "agentManager.setWorktreePinned", worktreeId: wt.id, pinned: false })
  }

  const renderWorktree = (worktree: WorktreeState, idx: () => number, list: WorktreeState[]) => {
    const label = () => firstOrderedTitle(sessions(worktree.id), store.tabOrder()[worktree.id], worktree.branch)
    const subtitle = () => (label() !== worktree.branch ? worktree.branch : undefined)
    const values = () => row(worktree.id)
    const sortable = createSortable(scope("worktree", worktree.id))
    void sortable
    return (
      <div use:sortable class={`am-wt-sortable ${sortable.isActiveDraggable ? "am-wt-dragging" : ""}`}>
        <WorktreeItem
          completed={completion.completed(worktree.id)}
          onCompletionEnd={() => completion.release(worktree.id)}
          worktree={worktree}
          sidebarId={`${props.project.id}:${worktree.id}`}
          label={worktree.label || label()}
          subtitle={worktree.label ? (worktree.label !== worktree.branch ? worktree.branch : undefined) : subtitle()}
          active={active() && props.selection === worktree.id}
          pendingDelete={
            props.deletion.pending()?.projectId === props.project.id &&
            props.deletion.pending()?.worktreeId === worktree.id
          }
          busy={props.busy(worktree.id)}
          activity={props.activityFor(worktree.id)}
          blocked={props.blocked(worktree.id)}
          stale={
            state()?.staleWorktreeIds?.includes(worktree.id) === true ||
            actionable(state()?.worktreeHealth?.[worktree.id])
          }
          health={state()?.worktreeHealth?.[worktree.id]}
          stats={props.stats?.[worktree.id]}
          shortcut={values().shortcut}
          navHint={values().navHint}
          sessions={store.managedSessions().filter((session) => session.worktreeId === worktree.id).length}
          grouped={isGrouped(worktree)}
          groupStart={isGroupStart(worktree, idx(), list)}
          groupEnd={isGroupEnd(worktree, idx(), list)}
          groupSize={worktree.groupId ? sorted().filter((item) => item.groupId === worktree.groupId).length : 0}
          renaming={renaming() === worktree.id}
          renameValue={name()}
          closeKeybind={values().closeKeybind}
          openKeybind={values().openKeybind}
          pr={props.prs?.[worktree.id] ?? undefined}
          runStatus={runs()[worktree.id]}
          sections={sections()}
          currentSectionId={worktree.sectionId}
          onMoveToSection={(sectionId) => {
            post({ type: "agentManager.moveToSection", worktreeIds: [worktree.id], sectionId })
            unpinForMove(worktree, sectionId)
          }}
          onMoveToNewSection={() => {
            unpin(worktree)
            props.onCreateSection([worktree.id])
          }}
          pinned={worktree.pinned}
          onTogglePin={() =>
            post({ type: "agentManager.setWorktreePinned", worktreeId: worktree.id, pinned: !worktree.pinned })
          }
          onClick={() => props.onSelectWorktree(props.project.id, worktree.id)}
          onCancelDelete={props.deletion.cancel}
          onDelete={(event) => {
            event.stopPropagation()
            props.deletion.confirm(props.project.id, worktree.id)
          }}
          onStartRename={(value) => {
            setName(value)
            setRenaming(worktree.id)
          }}
          onRenameInput={setName}
          onCommitRename={() => commitRename(worktree.id)}
          onCancelRename={cancelRename}
          onRemoveStale={() => {
            post({ type: "agentManager.removeStaleWorktree", worktreeId: worktree.id })
            props.deletion.select(props.project.id, worktree.id)
          }}
          onRemoveKeepSessions={() => {
            post({ type: "agentManager.removeStaleWorktree", worktreeId: worktree.id, keepSessions: true })
            props.deletion.select(props.project.id, worktree.id)
          }}
          onRestore={() => post({ type: "agentManager.restoreWorktree", worktreeId: worktree.id })}
          onUpdateBase={() =>
            updateBase(
              worktree.id,
              props.project.id,
              state()?.sessions.find(
                (item) => item.worktreeId === worktree.id && item.id === props.currentSessionID?.(),
              )?.id,
            )
          }
          onCopyPath={() => navigator.clipboard.writeText(worktree.path)}
          onOpen={() => post({ type: "agentManager.openWorktree", worktreeId: worktree.id })}
          onOpenComments={() => props.onOpenComments?.(props.project.id, worktree.id)}
          onOpenPR={() => props.onOpenPR?.(props.project.id, worktree.id)}
        />
      </div>
    )
  }

  return (
    <div class="am-project-body" data-project-body={props.project.id}>
      <button
        class="am-local-item"
        classList={{ "am-local-item-active": active() && props.selection === "local" }}
        data-sidebar-id={`${props.project.id}:local`}
        onClick={() => props.onSelectLocal(props.project.id)}
      >
        <LocalActivity state={localState()} label={props.t(label(localState()))} />
        <div class="am-local-text">
          <span class="am-local-label">{props.t("agentManager.local")}</span>
          <Show when={props.local === undefined}>
            <span class="am-local-branch-skeleton" />
          </Show>
          <Show when={props.local?.branch}>
            <span class="am-local-branch">{props.local!.branch}</span>
          </Show>
        </div>
        <div class="am-wt-actions-cell">
          <Show when={props.local === undefined}>
            <StatsSkeleton />
          </Show>
          <Show
            when={
              props.local && (props.local.additions || props.local.deletions || props.local.ahead || props.local.behind)
            }
          >
            <div class="am-worktree-stats">
              <Show when={props.local!.behind}>
                <span class="am-worktree-behind">↓{props.local!.behind}</span>
              </Show>
              <Show when={props.local!.ahead}>
                <span class="am-worktree-commits">↑{props.local!.ahead}</span>
              </Show>
              <Show when={props.local!.additions}>
                <span class="am-stat-additions">+{props.local!.additions}</span>
              </Show>
              <Show when={props.local!.deletions}>
                <span class="am-stat-deletions">−{props.local!.deletions}</span>
              </Show>
            </div>
          </Show>
          <div class="am-wt-hover-actions">
            <Show when={props.shortcutMap?.().get(`${props.project.id}:local`)}>
              {(shortcut) => (
                <span class="am-shortcut-badge">
                  {isMac ? "⌘" : "Ctrl+"}
                  {shortcut()}
                </span>
              )}
            </Show>
          </div>
        </div>
      </button>

      <div class="am-section">
        <div class="am-worktree-list">
          <OrphanNotice orphans={store.orphanDirectories()} onResolve={openOrphanDialog} />
          <Show when={state()} fallback={<WorktreeSkeleton />}>
            <DragDropProvider
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              collisionDetector={detector}
            >
              <DragDropSensors />
              <ConstrainDragXAxis />
              <SortableProvider ids={dragIds()}>
                <Show when={pinned().length > 0}>
                  <div class="am-pinned-group" data-pinned-group={props.project.id}>
                    <div class="am-pinned-header">
                      <span class="am-pinned-icon">
                        <Icon name="pin-filled" size="small" />
                      </span>
                      <span class="am-pinned-label">{props.t("agentManager.worktree.pinned")}</span>
                    </div>
                    <For each={pinned()}>{(wt, idx) => renderWorktree(wt, idx, pinned())}</For>
                  </div>
                </Show>
                <For each={top()}>
                  {(item, index) => {
                    if (item.kind === "worktree") {
                      const list = ungrouped()
                      return renderWorktree(item.wt, () => list.indexOf(item.wt), list)
                    }
                    const section = item.section
                    const list = members(section.id)
                    return (
                      <SectionHeader
                        section={section}
                        dropId={scope("section", section.id)}
                        count={memberCount(section.id)}
                        autoRename={props.renamingSection() === section.id}
                        onRenameEnd={() => {
                          if (props.renamingSection() === section.id) props.onRenameEnd()
                        }}
                        onToggle={() => post({ type: "agentManager.toggleSectionCollapsed", sectionId: section.id })}
                        onRename={(value: string) =>
                          post({ type: "agentManager.renameSection", sectionId: section.id, name: value })
                        }
                        onDelete={() => post({ type: "agentManager.deleteSection", sectionId: section.id })}
                        onSetColor={(color: string | null) =>
                          post({ type: "agentManager.setSectionColor", sectionId: section.id, color })
                        }
                        isFirst={index() === 0}
                        isLast={index() === top().length - 1}
                        onMoveUp={() => post({ type: "agentManager.moveSection", sectionId: section.id, dir: -1 })}
                        onMoveDown={() => post({ type: "agentManager.moveSection", sectionId: section.id, dir: 1 })}
                      >
                        <Show when={!section.collapsed}>
                          <div class="am-section-group-body">
                            <For each={list}>{(wt, wtIndex) => renderWorktree(wt, wtIndex, list)}</For>
                          </div>
                        </Show>
                      </SectionHeader>
                    )
                  }}
                </For>
              </SortableProvider>
              <DragOverlay>
                {(() => {
                  const wt = sorted().find((item) => item.id === dragging())
                  if (!wt) return null
                  return (
                    <div class="am-wt-overlay">
                      <Icon name="branch" size="small" />
                      <span>{wt.label || firstOrderedTitle(sessions(wt.id), store.tabOrder()[wt.id], wt.branch)}</span>
                    </div>
                  )
                })()}
              </DragOverlay>
            </DragDropProvider>
          </Show>
        </div>
      </div>
    </div>
  )
}
