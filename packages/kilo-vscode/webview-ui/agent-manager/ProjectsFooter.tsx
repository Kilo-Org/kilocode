/** @jsxImportSource solid-js */

import type { Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"

interface ProjectsFooterProps {
  label: string
  onAdd: () => void
}

/** Fixed Add project row that stays visible below the scrolling project list. */
export const ProjectsFooter: Component<ProjectsFooterProps> = (props) => (
  <div class="am-projects-footer">
    <Button
      variant="ghost"
      size="small"
      icon="folder-add-left"
      class="am-project-add"
      data-full-width="true"
      aria-label={props.label}
      onClick={props.onAdd}
    >
      {props.label}
    </Button>
  </div>
)
