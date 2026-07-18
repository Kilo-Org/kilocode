/** @jsxImportSource solid-js */

import { Show, type Component, type JSX } from "solid-js"
import type { ProjectSummary } from "../src/types/messages"

/**
 * Renders a single registered project as a collapsible accordion header
 * plus its body content (Local item + Worktrees section + Unassigned
 * sessions).
 *
 * When the project is the legacy root (`isLegacyRoot === true`), the
 * header is rendered without the project-label affordances so the
 * single-project UX is observationally identical to today's Agent Manager.
 * When the project is not the legacy root (i.e. an external repo), the
 * full header is rendered with label, count, and overflow menu.
 */

export interface ProjectAccordionProps {
  project: ProjectSummary
  /** Total number of worktrees registered for this project. */
  worktreeCount: number
  /** Total number of sessions (Local + worktree) owned by this project. */
  sessionCount: number
  /** Whether the accordion body is expanded. */
  expanded: boolean
  /** Display label shown in the header (defaults to the trailing path segment). */
  displayLabel: string
  /** Stable id used for ARIA + keyboard navigation. */
  sectionId: string
  /** Toggled when the header chevron is clicked. */
  onToggleCollapsed: () => void
  /** Triggered when the user clicks the project `[+]` action. */
  onAddWorktree?: () => void
  /** Triggered when the user picks "Add to VS Code workspace". */
  onAddToWorkspace?: () => void
  /** When true, render the project-label header (i.e. multi-project UI). */
  showLabel: boolean
  /** Content rendered inside the body when expanded. */
  children: JSX.Element
}

export const ProjectAccordion: Component<ProjectAccordionProps> = (props) => {
  const showHeader = () => props.showLabel
  const sectionClass = () => (showHeader() ? "am-project am-project-multi" : "am-project am-project-single")
  const labelId = () => "am-project" + props.project.id + "label"
  return (
    <section class={sectionClass()} data-project-id={props.project.id} aria-labelledby={labelId()}>
      <Show when={showHeader()}>
        <header class="am-project-header">
          <button
            type="button"
            class="am-project-toggle"
            data-sidebar-id={`project:${props.project.id}`}
            aria-expanded={props.expanded}
            aria-controls={props.sectionId}
            onClick={() => props.onToggleCollapsed()}
          >
            <span class="am-project-chevron" aria-hidden="true">
              <svg viewBox="0 0 12 12" width="10" height="10">
                <path
                  d={props.expanded ? "M3 4.5 L6 7.5 L9 4.5" : "M4.5 3 L7.5 6 L4.5 9"}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span id={labelId()} class="am-project-label">
              {props.displayLabel}
            </span>
            <Show when={props.worktreeCount > 0 || props.sessionCount > 0}>
              <span class="am-project-count" title={`${props.worktreeCount} worktrees, ${props.sessionCount} sessions`}>
                {props.worktreeCount}
              </span>
            </Show>
            <Show when={!props.project.trusted}>
              <span
                class="am-project-trust-badge"
                aria-label="Untrusted project"
                title="Untrusted — setup, run, and .env scripts are disabled"
              >
                !
              </span>
            </Show>
          </button>
          <div class="am-project-actions">
            <Show when={props.onAddWorktree}>
              <button
                type="button"
                class="am-project-action"
                aria-label="New worktree"
                title="New worktree"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onAddWorktree?.()
                }}
              >
                +
              </button>
            </Show>
            <Show when={props.onAddToWorkspace}>
              <details class="am-project-menu">
                <summary
                  class="am-project-action"
                  aria-label="Project menu"
                  title="Project menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  …
                </summary>
                <div class="am-project-menu-popover" role="menu">
                  <button
                    type="button"
                    class="am-project-menu-item"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation()
                      ;(document.activeElement as HTMLElement | null)?.blur()
                      props.onAddToWorkspace?.()
                    }}
                  >
                    Add to VS Code workspace
                  </button>
                </div>
              </details>
            </Show>
          </div>
        </header>
      </Show>
      <Show when={props.expanded || !showHeader()}>
        <div id={props.sectionId} class="am-project-body">
          {props.children}
        </div>
      </Show>
    </section>
  )
}
