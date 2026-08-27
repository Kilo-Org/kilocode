/** @jsxImportSource solid-js */

import { For, Show, untrack, type Accessor, type Component, type JSX } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import type { LanguageContextValue } from "../src/context/language"
import type { AgentProjectSnapshot } from "../src/types/messages"
import { SidebarSectionHeader } from "./SidebarSectionHeader"

interface ProjectsSectionProps {
  projects: AgentProjectSnapshot[]
  t: LanguageContextValue["t"]
  onAdd: () => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onExpand: (id: string, expanded: boolean) => void
  onHistory: (id: string) => void
  count: (id: string) => number | undefined
  tools?: JSX.Element
  body: (project: AgentProjectSnapshot) => JSX.Element
}

const ProjectBodySlot: Component<{
  project: Accessor<AgentProjectSnapshot>
  body: (project: AgentProjectSnapshot) => JSX.Element
}> = (props) => untrack(() => props.body(props.project()))

/**
 * Stable project accordion. Every expanded project renders the same real body;
 * active state only controls detail-pane emphasis.
 */
export const ProjectsSection: Component<ProjectsSectionProps> = (props) => (
  <div class="am-projects">
    <SidebarSectionHeader
      class="am-section-header"
      label={<span class="am-section-label">{props.t("agentManager.projects")}</span>}
      actions={
        <div class="am-projects-tools">
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            label={props.t("agentManager.project.add")}
            onClick={props.onAdd}
          />
          {props.tools}
        </div>
      }
    />
    <div class="am-projects-list">
      <For each={props.projects.map((project) => project.id)}>
        {(id) => {
          const project = () => props.projects.find((item) => item.id === id)!
          return (
            <div class="am-project">
              <SidebarSectionHeader
                class="am-project-item"
                expanded={project().expanded}
                ariaLabel={project().label}
                title={project().missing ? props.t("agentManager.project.missing") : project().root}
                label={
                  <>
                    <span class="am-project-label">{project().label}</span>
                    <Show when={props.count(project().id) !== undefined}>
                      <span class="am-project-count">({props.count(project().id)})</span>
                    </Show>
                    <Show when={project().missing}>
                      <Icon name="warning" size="small" />
                    </Show>
                  </>
                }
                actions={
                  <div class="am-project-actions-row">
                    <IconButton
                      icon="history"
                      size="small"
                      variant="ghost"
                      aria-label={props.t("session.showHistory")}
                      onClick={(event) => {
                        event.stopPropagation()
                        props.onHistory(project().id)
                      }}
                    />
                    <Show when={!project().pinned}>
                      <IconButton
                        icon="close-small"
                        size="small"
                        variant="ghost"
                        label={props.t("agentManager.project.remove")}
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onRemove(project().id)
                        }}
                      />
                    </Show>
                  </div>
                }
                onToggle={() => {
                  if (project().missing) return
                  const expanded = !project().expanded
                  props.onExpand(project().id, expanded)
                }}
                onClick={() => {
                  if (project().missing) return
                  if (!project().active) props.onSelect(project().id)
                }}
              />
              <Show when={project().expanded}>
                <ProjectBodySlot project={project} body={props.body} />
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  </div>
)
