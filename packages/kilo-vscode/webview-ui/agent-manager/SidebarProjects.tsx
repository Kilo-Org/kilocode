/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import type { ProjectSummary } from "../src/types/messages"
import { ProjectAccordion } from "./ProjectAccordion"

export interface SidebarProjectsProps {
  projects: () => ProjectSummary[]
  /** When true, render the multi-project accordion layout. When false, the
   *  caller should render the legacy sidebar body instead. */
  showMultiProject: () => boolean
  /** Single-project fallback (the legacy Local + Worktrees + Unassigned body). */
  renderLegacyBody: () => unknown
  displayLabel: (project: ProjectSummary) => string
  countWorktreesFor: (project: ProjectSummary) => number
  countSessionsFor: (project: ProjectSummary) => number
  onToggleProjectCollapsed: (projectId: string) => void
  onAddWorktree?: (project: ProjectSummary) => void
  onAddProjectToWorkspace: (projectId: string) => void
}

/**
 * Sidebar projection that renders either:
 *   - The multi-project accordion layout when 2+ projects are registered, or
 *   - A placeholder indicating the caller should render the legacy body.
 *
 * The actual legacy body is intentionally NOT rendered here — the caller
 * controls the fallback so the same component can sit alongside the global
 * project toolbar and the legacy single-project layout without duplication.
 */
export const SidebarProjects: Component<SidebarProjectsProps> = (props) => {
  return (
    <Show when={props.showMultiProject()} fallback={props.renderLegacyBody() as never}>
      <For each={props.projects()}>
        {(project) => (
          <ProjectAccordion
            project={project}
            worktreeCount={props.countWorktreesFor(project)}
            sessionCount={props.countSessionsFor(project)}
            expanded={!project.collapsed}
            displayLabel={props.displayLabel(project)}
            sectionId={`am-project${project.id}body`}
            showLabel={true}
            onToggleCollapsed={() => props.onToggleProjectCollapsed(project.id)}
            onAddWorktree={project.isLegacyRoot ? () => props.onAddWorktree?.(project) : undefined}
            onAddToWorkspace={() => props.onAddProjectToWorkspace(project.id)}
          >
            <Show
              when={project.isLegacyRoot}
              fallback={
                <div class="am-project-empty">
                  <span>{props.displayLabel(project)}</span>
                  <span>{"\u2014"}</span>
                </div>
              }
            >
              {props.renderLegacyBody() as never}
            </Show>
          </ProjectAccordion>
        )}
      </For>
    </Show>
  )
}
