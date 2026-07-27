import { Show } from "solid-js"
import { BasicTool as Base, GenericTool } from "@opencode-ai/ui/basic-tool"
import type { BasicToolProps as BaseProps, TriggerTitle } from "@opencode-ai/ui/basic-tool"
import { toolOpenKey, readToolOpen, writeToolOpen } from "./tool-open-state"
import { useToolApproval, ToolApprovalLine } from "./tool-approval"

export { GenericTool }
export type { TriggerTitle }

export interface BasicToolProps extends BaseProps {
  tool?: string
  callID?: string
  partID?: string
  approvalPlacement?: "body" | "hidden"
}

type OpenProps = Pick<BasicToolProps, "tool" | "callID" | "partID" | "forceOpen" | "defaultOpen">

export function initialOpen(props: OpenProps) {
  return props.forceOpen ? true : readToolOpen(toolOpenKey(props), props.defaultOpen)
}

export function useToolApprovalLine() {
  const approval = useToolApproval()
  return () => {
    const value = approval()
    return value ? <ToolApprovalLine display={value} /> : null
  }
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
  const approval = useToolApproval()
  // "hidden" means BasicTool must not inject the line (the card renders it itself, or it is omitted).
  const inBody = () => props.approvalPlacement !== "hidden" && approval() !== undefined
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    props.onOpenChange?.(open)
  }
  const details = () => (
    <div data-slot="basic-tool-details">
      <Show when={approval()}>{(value) => <ToolApprovalLine display={value()} />}</Show>
      {props.children}
    </div>
  )
  if (!("children" in props) && !inBody()) {
    return <Base {...props} defaultOpen={initial()} retainDetails={props.defer} onOpenChange={change} />
  }
  return (
    <Base {...props} defaultOpen={initial()} retainDetails={props.defer} onOpenChange={change} hasDetails={inBody()}>
      {details()}
    </Base>
  )
}
