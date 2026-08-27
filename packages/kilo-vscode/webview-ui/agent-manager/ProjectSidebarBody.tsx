import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
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
import { useVSCode } from "../src/context/vscode"
import SectionHeader from "./SectionHeader"
import { SidebarSectionHeader } from "./SidebarSectionHeader"
import { WorktreeItem } from "./WorktreeItem"
import { ProjectActions } from "./ProjectActions"
import { StatsSkeleton, WorktreeSkeleton } from "./Skeleton"
import { applyTabOrder, firstOrderedTitle, reorderTabs } from "./tab-order"
import { buildTopLevelItems, sortWorktrees, isGroupEnd, isGroupStart, isGrouped } from "./section-helpers"
import { sectionAwareDetector } from "./section-dnd"
import { ConstrainDragXAxis } from "./constrain-drag-x"
import { createProjectStore, type ProjectStore } from "./project/store"
import { randomColor } from "./section-colors"
import { projectSidebarOrder, projectWorktreeRow } from "./project-local-navigation"
import { rootSessions } from "./project/session-filter"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

interface Props {
  project: AgentProjectSnapshot
  state?: AgentManagerStateMessage
  store?: ProjectStore
  busy?: (id: string) => boolean
  working?: (id: string, waiting?: boolean) => boolean
  localBusy?: () => boolean
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
  onNewWorktree: (projectId: string) => void
  shortcutMap?: () => Map<string, number>
}

/** Permanent real sidebar body for one expanded project. */
export const ProjectSidebarBody: Component<Props> = (props) => {
  const vscode = useVSCode()
  const store = props.store ?? createProjectStore(props.project.id)
  if (!props.store) {
    createEffect(() => {
      const state = props.state
      if (state) store.applyState(state)
    })
  }
  const [pending, setPending] = createSignal<string>()
  const [renaming, setRenaming] = createSignal<string>()
  const [renamingSection, setRenamingSection] = createSignal<string>()
  const [pendingSection, setPendingSection] = createSignal<
    { ids: Set<string>; state?: AgentManagerStateMessage } | undefined
  >()
  const [dragging, setDragging] = createSignal<string>()
  const [dragOrigin, setDragOrigin] = createSignal<string[]>()
  const [name, setName] = createSignal("")
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pendingTimer))
  /** Arm on the first click, execute on the second, matching the legacy sidebar. */
  const confirmDelete = (worktreeId: string) => {
    if (props.busy?.(worktreeId) || props.working?.(worktreeId, true)) return
    if (pending() === worktreeId) {
      clearTimeout(pendingTimer)
      setPending(undefined)
      post({ type: "agentManager.deleteWorktree", worktreeId })
      return
    }
    clearTimeout(pendingTimer)
    setPending(worktreeId)
    pendingTimer = setTimeout(() => setPending(undefined), 2500)
  }
  const state = () => props.state
  const sessions = (worktreeId: string | null) => rootSessions(props.sessions ?? [], worktreeId)
  const active = () => props.selectedProject === props.project.id
  const runs = () => store.runStatuses()
  const sections = () => store.sections()
  const worktrees = () => store.worktrees()
  const order = () => store.worktreeOrder()
  const sorted = createMemo(() => sortWorktrees(worktrees(), order()))
  const members = (sectionId: string) => sorted().filter((wt) => wt.sectionId === sectionId)
  const ungrouped = createMemo(() => sorted().filter((wt) => !wt.sectionId))
  const top = createMemo(() => buildTopLevelItems(sections(), ungrouped(), sorted(), order()))
  const sidebarOrder = createMemo(() => projectSidebarOrder(top(), sorted(), sections(), members))
  const post = (message: Record<string, unknown>) =>
    vscode.postMessage({ ...message, projectId: props.project.id } as never)

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

  const createSection = (worktreeIds?: string[]) => {
    setPendingSection({ ids: new Set(sections().map((section) => section.id)), state: state() })
    post({
      type: "agentManager.createSection",
      name: props.t("agentManager.section.defaultName"),
      color: randomColor(),
      worktreeIds,
    })
  }

  createEffect(() => {
    const previous = pendingSection()
    if (!previous) return
    const current = state()
    if (current === previous.state) return
    const created = (current?.sections ?? []).find((section) => !previous.ids.has(section.id))
    setPendingSection(undefined)
    if (!created) return
    setRenamingSection(created.id)
  })

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
    document.body.classList.add("am-wt-dragging-active")
  }

  const onDragOver = (event: DragEvent) => {
    const from = parse("worktree", event.draggable?.id)
    const to = parse("worktree", event.droppable?.id)
    if (!from || !to || !worktreeIds().has(from) || !worktreeIds().has(to)) return
    store.setWorktreeOrder((previous) => {
      const current = applyTabOrder(
        sorted().map((wt) => ({ id: wt.id })),
        previous,
      ).map((item) => item.id)
      return reorderTabs(current, from, to) ?? previous
    })
  }

  const onDragEnd = (event: DragEvent) => {
    const from = parse("worktree", event.draggable?.id)
    const section = parse("section", event.droppable?.id)
    const to = parse("worktree", event.droppable?.id)
    setDragging(undefined)
    const origin = dragOrigin()
    setDragOrigin(undefined)
    document.body.classList.remove("am-wt-dragging-active")
    if (!from || !worktreeIds().has(from)) {
      if (origin) store.setWorktreeOrder(origin)
      return
    }
    if (section && sections().some((item) => item.id === section)) {
      post({ type: "agentManager.moveToSection", worktreeIds: [from], sectionId: section })
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

  const renderWorktree = (worktree: WorktreeState, idx: () => number, list: WorktreeState[]) => {
    const label = () => firstOrderedTitle(sessions(worktree.id), store.tabOrder()[worktree.id], worktree.branch)
    const subtitle = () => (label() !== worktree.branch ? worktree.branch : undefined)
    const values = () => row(worktree.id)
    const sortable = createSortable(scope("worktree", worktree.id))
    void sortable
    return (
      <div use:sortable class={`am-wt-sortable ${sortable.isActiveDraggable ? "am-wt-dragging" : ""}`}>
        <WorktreeItem
          worktree={worktree}
          sidebarId={`${props.project.id}:${worktree.id}`}
          label={worktree.label || label()}
          subtitle={worktree.label ? (worktree.label !== worktree.branch ? worktree.branch : undefined) : subtitle()}
          active={active() && props.selection === worktree.id}
          pendingDelete={pending() === worktree.id}
          busy={props.busy?.(worktree.id) ?? false}
          working={props.working?.(worktree.id) || runs()[worktree.id]?.state === "running"}
          blocked={props.working?.(worktree.id, true)}
          stale={state()?.staleWorktreeIds?.includes(worktree.id) === true}
          stats={props.stats?.[worktree.id]}
          shortcut={values().shortcut}
          navHint={values().navHint}
          sessions={sessions(worktree.id).length}
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
          onMoveToSection={(sectionId) =>
            post({ type: "agentManager.moveToSection", worktreeIds: [worktree.id], sectionId })
          }
          onMoveToNewSection={() => createSection([worktree.id])}
          onClick={() => {
            if (pending() === worktree.id) return confirmDelete(worktree.id)
            props.onSelectWorktree(props.project.id, worktree.id)
          }}
          onDelete={(event) => {
            event.stopPropagation()
            confirmDelete(worktree.id)
          }}
          onStartRename={(value) => {
            setName(value)
            setRenaming(worktree.id)
          }}
          onRenameInput={setName}
          onCommitRename={() => commitRename(worktree.id)}
          onCancelRename={cancelRename}
          onRemoveStale={() => post({ type: "agentManager.removeStaleWorktree", worktreeId: worktree.id })}
          onCopyPath={() => navigator.clipboard.writeText(worktree.path)}
          onOpen={() => post({ type: "agentManager.openWorktree", worktreeId: worktree.id })}
          onOpenPR={() => {
            const url = props.prs?.[worktree.id]?.url
            post({ type: "agentManager.openPR", worktreeId: worktree.id, ...(url ? { url } : {}) })
          }}
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
        <Show when={!props.localBusy?.()} fallback={<Spinner class="am-worktree-spinner" />}>
          <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
            <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
            <path d="M10 13.5V16.5" stroke="currentColor" />
          </svg>
        </Show>
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
        <SidebarSectionHeader
          class="am-section-header"
          label={<span class="am-section-label">{props.t("agentManager.section.worktrees")}</span>}
          actions={
            <ProjectActions
              branch={state()?.defaultBaseBranch ?? props.local?.branch ?? "main"}
              bindings={props.bindings}
              loaded={state() !== undefined}
              t={props.t}
              onCreate={() => post({ type: "agentManager.createWorktree" })}
              onNew={() => props.onNewWorktree(props.project.id)}
              onSection={() => createSection()}
              onSettings={() =>
                vscode.postMessage({ type: "openSettingsPanel", tab: "agentManager", projectId: props.project.id })
              }
            />
          }
        />
        <div class="am-worktree-list">
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
                        count={list.length}
                        autoRename={renamingSection() === section.id}
                        onRenameEnd={() => {
                          if (renamingSection() === section.id) setRenamingSection(undefined)
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
