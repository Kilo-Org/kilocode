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
  onTrust: (id: string) => void
  onExpand: (id: string, expanded: boolean) => void
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
          {props.tools}
          <IconButton
            icon="plus"
            size="small"
            variant="ghost"
            label={props.t("agentManager.project.add")}
            onClick={props.onAdd}
          />
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
                    <Show when={!project().trusted && !project().missing}>
                      <span class="am-project-trust">
                        <Icon name="lock" size="small" />
                        {props.t("agentManager.project.trust")}
                      </span>
                    </Show>
                  </>
                }
                actions={
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
                }
                onToggle={() => {
                  if (project().missing) return
                  if (!project().trusted) {
                    props.onTrust(project().id)
                    return
                  }
                  const expanded = !project().expanded
                  props.onExpand(project().id, expanded)
                  if (!project().active && project().trusted) props.onSelect(project().id)
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
