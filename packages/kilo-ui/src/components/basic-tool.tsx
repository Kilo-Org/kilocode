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

/**
 * Whether BasicTool should inject the approval line into its body.
 */
export function shouldRenderApprovalInBody(placement: BasicToolProps["approvalPlacement"], hasApproval: boolean) {
  return placement !== "hidden" && hasApproval
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
  const approval = useToolApproval()
  const inBody = () => shouldRenderApprovalInBody(props.approvalPlacement, approval() !== undefined)
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    props.onOpenChange?.(open)
  }
  const details = () => (
    <div data-slot="basic-tool-details">
      <Show when={inBody() && approval()}>{(value) => <ToolApprovalLine display={value()} />}</Show>
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
