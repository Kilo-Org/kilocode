import { For, Show, createMemo, createSignal, onCleanup, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { DragDropProvider, DragDropSensors } from "@thisbeyond/solid-dnd"
import type {
  AgentManagerStateMessage,
  AgentProjectSnapshot,
  LocalGitStats,
  PRStatus,
  ProjectSessionInfo,
  WorktreeGitStats,
} from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import { useVSCode } from "../src/context/vscode"
import { formatRelativeDate } from "../src/utils/date"
import SectionHeader from "./SectionHeader"
import { WorktreeItem } from "./WorktreeItem"
import { UnassignedSessionsSection } from "./UnassignedSessionsSection"
import { ProjectActions } from "./ProjectActions"

interface Props {
  project: AgentProjectSnapshot
  state?: AgentManagerStateMessage
  busy?: (id: string) => boolean
  stats?: Record<string, WorktreeGitStats>
  local?: LocalGitStats
  prs?: Record<string, PRStatus | null>
  sessions?: ProjectSessionInfo[]
  selectedProject?: string
  selection?: string
  bindings: Record<string, string>
  t: LanguageContextValue["t"]
  onSelectLocal: (projectId: string) => void
  onSelectWorktree: (projectId: string, worktreeId: string) => void
  onSelectSession: (projectId: string, sessionId: string) => void
  onNewWorktree: (projectId: string) => void
  onDefaultBranch: (projectId: string, selected?: string, detected?: string) => void
}

/** Permanent real sidebar body for one expanded project. */
export const ProjectSidebarBody: Component<Props> = (props) => {
  const vscode = useVSCode()
  const [pending, setPending] = createSignal<string>()
  const [renaming, setRenaming] = createSignal<string>()
  const [name, setName] = createSignal("")
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pendingTimer))
  /** Arm on the first click, execute on the second, matching the legacy sidebar. */
  const confirmDelete = (worktreeId: string) => {
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
  const sessions = (worktreeId: string | null) =>
    (props.sessions ?? []).filter((item) => item.worktreeId === worktreeId)
  const active = () => props.selectedProject === props.project.id
  const runs = createMemo(() => Object.fromEntries((state()?.runStatuses ?? []).map((run) => [run.worktreeId, run])))
  const sections = () => state()?.sections ?? []
  const localSessions = () => sessions(null)
  const ungrouped = () => state()?.worktrees.filter((wt) => !wt.sectionId) ?? []
  const members = (sectionId: string) => state()?.worktrees.filter((wt) => wt.sectionId === sectionId) ?? []
  const post = (message: Record<string, unknown>) =>
    vscode.postMessage({ ...message, projectId: props.project.id } as never)

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

  const renderWorktree = (worktree: NonNullable<Props["state"]>["worktrees"][number]) => (
    <WorktreeItem
      worktree={worktree}
      sidebarId={`${props.project.id}:${worktree.id}`}
      label={worktree.label || worktree.branch}
      subtitle={worktree.label && worktree.label !== worktree.branch ? worktree.branch : undefined}
      active={active() && props.selection === worktree.id}
      pendingDelete={pending() === worktree.id}
      busy={props.busy?.(worktree.id) ?? false}
      working={runs()[worktree.id]?.state === "running"}
      stale={state()?.staleWorktreeIds?.includes(worktree.id) === true}
      stats={props.stats?.[worktree.id]}
      sessions={sessions(worktree.id).length}
      grouped={false}
      groupStart={false}
      groupEnd={false}
      groupSize={0}
      renaming={renaming() === worktree.id}
      renameValue={name()}
      closeKeybind=""
      openKeybind=""
      pr={props.prs?.[worktree.id] ?? undefined}
      runStatus={runs()[worktree.id]}
      sections={sections()}
      currentSectionId={worktree.sectionId}
      onMoveToSection={(sectionId) =>
        post({ type: "agentManager.moveToSection", worktreeIds: [worktree.id], sectionId })
      }
      onMoveToNewSection={() =>
        post({
          type: "agentManager.createSection",
          name: props.t("agentManager.worktree.newSection"),
          worktreeIds: [worktree.id],
        })
      }
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
      onOpenPR={() => post({ type: "agentManager.openPR", worktreeId: worktree.id })}
    />
  )

  return (
    <div class="am-project-body" data-project-body={props.project.id}>
      <Show
        when={state()}
        fallback={
          <div class="am-project-loading">
            <Spinner class="am-worktree-spinner" />
          </div>
        }
      >
        <button
          class="am-local-item"
          classList={{ "am-local-item-active": active() && props.selection === "local" }}
          data-sidebar-id={`${props.project.id}:local`}
          onClick={() => props.onSelectLocal(props.project.id)}
        >
          <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
            <path d="M6 16.5H14" stroke="currentColor" stroke-linecap="square" />
            <path d="M10 13.5V16.5" stroke="currentColor" />
          </svg>
          <div class="am-local-text">
            <span class="am-local-label">{props.t("agentManager.local")}</span>
            <Show when={props.local?.branch}>
              <span class="am-local-branch">{props.local!.branch}</span>
            </Show>
          </div>
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
        </button>

        <div class="am-section">
          <div class="am-section-header">
            <span class="am-section-label">{props.t("agentManager.section.worktrees")}</span>
            <ProjectActions
              branch={state()?.defaultBaseBranch ?? props.local?.branch ?? "main"}
              bindings={props.bindings}
              loaded={state() !== undefined}
              t={props.t}
              onCreate={() => post({ type: "agentManager.createWorktree" })}
              onNew={() => props.onNewWorktree(props.project.id)}
              onSection={() =>
                post({
                  type: "agentManager.createSection",
                  name: props.t("agentManager.section.defaultName"),
                })
              }
              onSetup={() => post({ type: "agentManager.configureSetupScript" })}
              onBranch={() => props.onDefaultBranch(props.project.id, state()?.defaultBaseBranch, props.local?.branch)}
            />
          </div>
          <div class="am-worktree-list">
            {/*
              SectionHeader registers a drop target via solid-dnd, which throws
              without a DragDropProvider ancestor and kills the whole render.
              Multi-project has no drag-and-drop yet, so this provider is a
              no-op context until DnD lands here.
            */}
            <DragDropProvider onDragStart={() => {}} onDragEnd={() => {}}>
              <DragDropSensors />
              <For each={sections()}>
                {(section, index) => (
                  <SectionHeader
                    section={section}
                    count={members(section.id).length}
                    onToggle={() => post({ type: "agentManager.toggleSectionCollapsed", sectionId: section.id })}
                    onRename={(value: string) =>
                      post({ type: "agentManager.renameSection", sectionId: section.id, name: value })
                    }
                    onDelete={() => post({ type: "agentManager.deleteSection", sectionId: section.id })}
                    onSetColor={(color: string | null) =>
                      post({ type: "agentManager.setSectionColor", sectionId: section.id, color })
                    }
                    isFirst={index() === 0}
                    isLast={index() === sections().length - 1}
                    onMoveUp={() => post({ type: "agentManager.moveSection", sectionId: section.id, dir: -1 })}
                    onMoveDown={() => post({ type: "agentManager.moveSection", sectionId: section.id, dir: 1 })}
                  >
                    <Show when={!section.collapsed}>
                      <div class="am-section-group-body">
                        <For each={members(section.id)}>{renderWorktree}</For>
                      </div>
                    </Show>
                  </SectionHeader>
                )}
              </For>
              <For each={ungrouped()}>{renderWorktree}</For>
            </DragDropProvider>
          </div>
        </div>

        <UnassignedSessionsSection
          sessions={localSessions}
          loaded={() => props.sessions !== undefined}
          collapsed={() => state()!.sessionsCollapsed === true}
          active={() => undefined}
          onToggle={() => post({ type: "agentManager.setSessionsCollapsed", collapsed: !state()!.sessionsCollapsed })}
          onSelect={(sessionId) => props.onSelectSession(props.project.id, sessionId)}
          onPromote={(sessionId) => post({ type: "agentManager.promoteSession", sessionId })}
          onOpen={(sessionId) => post({ type: "agentManager.openLocally", sessionId })}
          sidebarId={(sessionId) => `${props.project.id}:sess:${sessionId}`}
        />
      </Show>
    </div>
  )
}
