// Project picker list for the New Worktree dialog

/** @jsxImportSource solid-js */

import { For, Show, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { AgentProjectSnapshot } from "../src/types/messages"

interface ProjectSelectProps {
  projects: AgentProjectSnapshot[]
  selected?: string
  onSelect: (id: string) => void
  labels: { missing: string }
}

export const ProjectSelect: Component<ProjectSelectProps> = (props) => (
  <div class="am-dropdown-list">
    <For each={props.projects}>
      {(project) => {
        const blocked = () => project.missing
        const hint = () => (project.missing ? props.labels.missing : project.root)
        const icon = () => {
          if (project.missing) return "warning" as const
          return "folder" as const
        }

        return (
          <button
            class="am-project-option"
            classList={{ "am-project-option-active": props.selected === project.id }}
            disabled={blocked()}
            title={hint()}
            onClick={() => props.onSelect(project.id)}
            type="button"
          >
            <span class="am-project-option-left">
              <Icon name={icon()} size="small" />
              <span class="am-project-option-name">{project.label}</span>
              <span class="am-project-option-root">{project.root}</span>
            </span>
            <Show when={props.selected === project.id}>
              <Icon name="check-small" size="small" />
            </Show>
          </button>
        )
      }}
    </For>
  </div>
)
