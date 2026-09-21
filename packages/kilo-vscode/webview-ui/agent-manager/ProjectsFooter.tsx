/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { DropdownMenu } from "@kilocode/kilo-ui/dropdown-menu"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { LanguageContextValue } from "../src/context/language"

interface ProjectsFooterProps {
  t: LanguageContextValue["t"]
  onCreate: () => void
  onAdd: () => void
  onClone: () => void
}

/** Project actions stay visible below the scrolling project list. */
export const ProjectsFooter: Component<ProjectsFooterProps> = (props) => {
  let footer: HTMLDivElement | undefined
  return (
    <div class="am-projects-footer" ref={(el) => (footer = el)}>
      <Button variant="ghost" size="small" icon="plus" class="am-project-create" onClick={props.onCreate}>
        <span class="am-project-label">{props.t("agentManager.project.new")}</span>
      </Button>
      <DropdownMenu gutter={4} placement="top-start" getAnchorRect={() => footer?.getBoundingClientRect()}>
        <DropdownMenu.Trigger as={Button} variant="ghost" size="small" icon="folder-add-left" class="am-project-add">
          <span class="am-project-label">{props.t("agentManager.project.add")}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="am-split-menu">
            <DropdownMenu.Item onSelect={props.onAdd}>
              <Icon name="folder" size="small" />
              <DropdownMenu.ItemLabel>{props.t("agentManager.project.openLocal")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={props.onClone}>
              <Icon name="download" size="small" />
              <DropdownMenu.ItemLabel>{props.t("agentManager.project.clone")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
