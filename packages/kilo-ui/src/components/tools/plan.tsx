import { Show, type Component } from "solid-js"
import { relativizeProjectPath } from "../content-data"
import type { ToolProps } from "../message-part"

const label = "Plan ready"
const badge = "Plan"

function string(value: unknown) {
  return typeof value === "string" ? value : ""
}

export const PlanTool: Component<ToolProps> = (props) => {
  const plan = () => string(props.metadata.plan) || string(props.input.path)
  const display = () => relativizeProjectPath(plan(), props.directory)
  const open = (event: MouseEvent) => {
    event.preventDefault()
    if (!plan() || !props.actions?.openFile) return
    props.actions.openFile(plan())
  }
  return (
    <div data-component="plan-tool">
      <div data-slot="plan-tool-header">
        <span data-slot="plan-tool-label">{label}</span>
        <span data-slot="plan-tool-badge">{badge}</span>
      </div>
      <Show when={plan()}>
        <Show
          when={props.actions?.openFile}
          fallback={<span data-slot="plan-tool-path">{display()}</span>}
        >
          <a data-slot="plan-tool-open" href="#" onClick={open}>
            {display()}
          </a>
        </Show>
      </Show>
      <Show when={props.output}>
        <div data-slot="plan-tool-body">{props.output}</div>
      </Show>
    </div>
  )
}