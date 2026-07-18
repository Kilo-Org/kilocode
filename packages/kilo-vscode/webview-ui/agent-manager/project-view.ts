/** @jsxImportSource solid-js */

/**
 * Project accordion plumbing for the Agent Manager sidebar (ticket #12353).
 *
 * The helper collects the click handlers, label formatters, and counters
 * that bridge the `ProjectSummary[]` projection pushed from the extension
 * to the `SidebarProjects` component. Kept in its own module so the
 * `AgentManagerApp.tsx` file stays under its `max-lines` cap.
 */

import type { Accessor } from "solid-js"
import type { ProjectSummary, WorktreeState, ManagedSessionState } from "../src/types/messages"

export interface ProjectActions {
  addProject: () => void
  toggleProjectCollapsed: (projectId: string) => void
  addFolderToWorkspace: (projectId: string) => void
}

export interface ProjectCounters {
  worktrees: Accessor<WorktreeState[]>
  managedSessions: Accessor<ManagedSessionState[]>
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export const useProjectView = (
  projects: Accessor<ProjectSummary[]>,
  counters: ProjectCounters,
  actions: ProjectActions,
) => {
  const showMultiProject = () => projects().length >= 2
  const displayLabel = (project: ProjectSummary) => project.label ?? basename(project.root)
  const countWorktreesFor = (project: ProjectSummary) => (project.isLegacyRoot ? counters.worktrees().length : 0)
  const countSessionsFor = (project: ProjectSummary) => (project.isLegacyRoot ? counters.managedSessions().length : 0)

  return {
    showMultiProject,
    displayLabel,
    countWorktreesFor,
    countSessionsFor,
    onAddProject: actions.addProject,
    onToggleProjectCollapsed: actions.toggleProjectCollapsed,
    onAddProjectToWorkspace: actions.addFolderToWorkspace,
  }
}
