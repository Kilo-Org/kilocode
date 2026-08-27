import { createMemo, type Component } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import type {
  AgentManagerStateMessage,
  AgentProjectSnapshot,
  LocalGitStats,
  PRStatus,
  ProjectSessionInfo,
  WorktreeGitStats,
} from "../src/types/messages"
import type { LanguageContextValue } from "../src/context/language"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useVSCode } from "../src/context/vscode"
import { ProjectsSection } from "./ProjectsSection"
import { ProjectSidebarBody } from "./ProjectSidebarBody"
import { SidebarSearchMenu, type SidebarSearchMenuRef } from "./SidebarSearchMenu"
import type { SidebarSearchItem } from "./sidebar-search"
import { LOCAL } from "./navigate"
import { NewWorktreeDialog } from "./NewWorktreeDialog"
import type { ProjectStore } from "./project/store"
import type { ModeRouter } from "./mode-router"

const place = (state: AgentManagerStateMessage, session: ProjectSessionInfo, local: string) => {
  const wt = state.worktrees.find((item) => item.id === session.worktreeId)
  return wt?.label || wt?.branch || local
}

interface Props {
  projects: AgentProjectSnapshot[]
  states: Record<string, AgentManagerStateMessage>
  store?: (projectId: string) => ProjectStore
  stats: Record<string, Record<string, WorktreeGitStats>>
  local: Record<string, LocalGitStats>
  prs: Record<string, Record<string, PRStatus | null>>
  sessions: Record<string, ProjectSessionInfo[]>
  selectedProject?: string
  selection?: string
  currentSessionID?: () => string | undefined
  mode: ModeRouter
  defaultBase?: (projectId: string) => string | undefined
  onCreate?: (projectId: string) => void
  busy?: (projectId: string, id: string) => boolean
  working?: (projectId: string, id: string, waiting?: boolean) => boolean
  localBusy?: (projectId: string) => boolean
  bindings: Record<string, string>
  t: LanguageContextValue["t"]
  onSearchRef: (ref: SidebarSearchMenuRef) => void
  onShortcuts: () => void
  onHistory: (projectId: string) => void
  shortcutMap?: () => Map<string, number>
}

export const ProjectList: Component<Props> = (props) => {
  const vscode = useVSCode()
  const dialog = useDialog()
  const select = (target: Record<string, unknown>) =>
    vscode.postMessage({ type: "agentManager.activateSelection", target } as never)
  const search = createMemo(() => {
    const items: SidebarSearchItem[] = []
    for (const project of props.projects) {
      const state = props.states[project.id]
      if (!state) continue
      const local = props.sessions[project.id]?.filter((session) => session.worktreeId === null) ?? []
      items.push({
        key: `${project.id}:local`,
        projectId: project.id,
        kind: "local",
        group: "contexts",
        title: `${project.label} · ${props.t("agentManager.local")}`,
        meta: props.local[project.id]?.branch ? [props.local[project.id]!.branch] : [],
        search: [project.label, props.t("agentManager.local"), props.local[project.id]?.branch]
          .filter(Boolean)
          .join(" "),
        updatedAt: local.reduce((latest, session) => (session.updatedAt > latest ? session.updatedAt : latest), ""),
        state: "idle",
        visible: project.expanded,
        count: local.length,
      })
      for (const worktree of state.worktrees) {
        const sessions = props.sessions[project.id]?.filter((session) => session.worktreeId === worktree.id) ?? []
        items.push({
          key: `${project.id}:worktree:${worktree.id}`,
          projectId: project.id,
          kind: "worktree",
          group: "contexts",
          title: worktree.label || worktree.branch,
          meta: [project.label, worktree.branch],
          search: [project.label, worktree.label, worktree.branch, worktree.id].filter(Boolean).join(" "),
          updatedAt: worktree.createdAt,
          state: "idle",
          visible: project.expanded,
          worktreeId: worktree.id,
          count: sessions.length,
        })
      }
      for (const session of props.sessions[project.id] ?? []) {
        const wt = state.worktrees.find((item) => item.id === session.worktreeId)
        const where = place(state, session, props.t("agentManager.local"))
        items.push({
          key: `${project.id}:session:${session.id}`,
          projectId: project.id,
          kind: "session",
          group: "sessions",
          title: session.title || props.t("agentManager.session.untitled"),
          meta: [project.label, where],
          search: [project.label, where, wt?.branch, session.title, session.id].filter(Boolean).join(" "),
          updatedAt: session.updatedAt,
          state: "idle",
          visible: project.expanded,
          sessionId: session.id,
          location: session.worktreeId ? "worktree" : "local",
          worktreeId: session.worktreeId ?? undefined,
        })
      }
    }
    return items
  })
  const current = createMemo(() => {
    const projectId = props.selectedProject
    if (!projectId) return
    const worktree = search().find(
      (item) => item.projectId === projectId && item.kind === "worktree" && item.worktreeId === props.selection,
    )
    if (worktree) return worktree
    // On LOCAL, an open session tab is the active item when there is one, so the
    // menu highlights the same row the sidebar does.
    const session = props.currentSessionID?.()
    if (session) {
      const match = search().find(
        (item) => item.projectId === projectId && item.kind === "session" && item.sessionId === session,
      )
      if (match) return match
    }
    if (props.selection === LOCAL) return search().find((item) => item.key === `${projectId}:local`)
    return undefined
  })
  const selectSearch = (item: SidebarSearchItem) => {
    if (!item.projectId) return
    if (item.kind === "local") return select({ projectId: item.projectId, kind: "local" })
    if (item.kind === "worktree")
      return select({ projectId: item.projectId, kind: "worktree", worktreeId: item.worktreeId })
    return select({ projectId: item.projectId, kind: "session", sessionId: item.sessionId })
  }
  const newWorktree = (projectId: string) => {
    dialog.show(() => (
      <NewWorktreeDialog
        projectId={projectId}
        projects={() => props.projects}
        activeProjectId={props.selectedProject}
        defaultBase={props.defaultBase}
        onCreate={props.onCreate}
        mode={props.mode}
        onClose={() => dialog.close()}
      />
    ))
  }
  return (
    <ProjectsSection
      projects={props.projects}
      t={props.t}
      tools={
        <>
          <SidebarSearchMenu
            ref={props.onSearchRef}
            items={search}
            current={current}
            keybind={props.bindings.search ?? ""}
            portal
            labels={{
              search: props.t("agentManager.sidebarSearch.label"),
              scope: props.t("agentManager.sidebarSearch.scope"),
              sessions: props.t("agentManager.section.sessions"),
              contexts: props.t("agentManager.sidebarSearch.contexts"),
              waiting: props.t("agentManager.tabsMenu.status.waiting"),
              retry: props.t("agentManager.tabsMenu.status.retry"),
            }}
            onSelect={selectSearch}
          />
          <TooltipKeybind
            title={props.t("agentManager.shortcuts.title")}
            keybind={props.bindings.showShortcuts ?? ""}
            placement="bottom"
          >
            <IconButton
              icon="keyboard"
              size="small"
              variant="ghost"
              label={props.t("agentManager.shortcuts.title")}
              onClick={props.onShortcuts}
            />
          </TooltipKeybind>
        </>
      }
      onAdd={() => vscode.postMessage({ type: "agentManager.addProject" })}
      onSelect={(projectId) =>
        // Selecting the project itself returns to where the user left off in it;
        // the extension resolves its persisted target authoritatively.
        vscode.postMessage({
          type: "agentManager.activateSelection",
          target: { projectId, kind: "local" },
          restore: true,
        })
      }
      onRemove={(projectId) => vscode.postMessage({ type: "agentManager.removeProject", projectId })}
      onHistory={props.onHistory}
      onExpand={(projectId, expanded) =>
        vscode.postMessage({ type: "agentManager.setProjectExpanded", projectId, expanded })
      }
      count={(projectId) => {
        const state = props.states[projectId]
        return state ? state.worktrees.length + 1 : undefined
      }}
      body={(project) => (
        <ProjectSidebarBody
          project={project}
          state={props.states[project.id]}
          store={props.store?.(project.id)}
          busy={(id) => props.busy?.(project.id, id) ?? false}
          working={(id, waiting) => props.working?.(project.id, id, waiting) ?? false}
          localBusy={() => props.localBusy?.(project.id) ?? false}
          stats={props.stats[project.id]}
          local={props.local[project.id]}
          prs={props.prs[project.id]}
          sessions={props.sessions[project.id]}
          selectedProject={props.selectedProject}
          selection={props.selection}
          currentSessionID={props.currentSessionID}
          bindings={props.bindings}
          t={props.t}
          onSelectLocal={(projectId) => select({ projectId, kind: "local" })}
          onSelectWorktree={(projectId, worktreeId) => select({ projectId, kind: "worktree", worktreeId })}
          onNewWorktree={newWorktree}
          shortcutMap={props.shortcutMap}
        />
      )}
    />
  )
}
