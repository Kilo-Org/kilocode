import { createMemo, Show, type JSX } from "solid-js"
import { BasicTool as Base, GenericTool } from "@opencode-ai/ui/basic-tool"
import type { BasicToolProps as BaseProps, TriggerTitle } from "@opencode-ai/ui/basic-tool"
import { toolOpenKey, readToolOpen, writeToolOpen } from "./tool-open-state"
import { useToolApproval, ToolApprovalLine } from "./tool-approval"
import { useToolSecurity, ToolSecurityBadge } from "./tool-security"

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

/**
 * The trigger with the security state chip folded in.
 *
 * It rides on the trigger rather than the body because `reviewing` is transient: by the time a user
 * expands the row the reviewer has long since answered. A trigger the caller built as an element
 * rather than a `TriggerTitle` has no slot to put it in, and is left alone.
 */
export function withSecurity(trigger: BasicToolProps["trigger"], badge: JSX.Element) {
  if (typeof trigger !== "object" || trigger === null || !("title" in trigger)) return trigger
  return { ...(trigger as TriggerTitle), status: badge }
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
  const approval = useToolApproval()
  const security = useToolSecurity()
  const trigger = () => {
    const value = security()
    return value ? withSecurity(props.trigger, <ToolSecurityBadge display={value} />) : props.trigger
  }
  const inBody = () => shouldRenderApprovalInBody(props.approvalPlacement, approval() !== undefined)
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    props.onOpenChange?.(open)
  }
  // Renders after the body/tool list, not before — it's context about what
  // happened, not part of the header.
  const buildDetails = () => (
    <div data-slot="basic-tool-details">
      {props.children}
      <Show when={inBody() && approval()}>{(value) => <ToolApprovalLine display={value()} />}</Show>
    </div>
  )
  // Base reads its children getter several times while laying out the tool, and a
  // bare accessor rebuilds this subtree on every read (for a bash card, three
  // BashHighlightedOutput instances per render). Memoize eager tools so repeated
  // reads reuse one subtree. Deferred tools must stay lazy: createMemo runs
  // eagerly, which would build a collapsed body before the card opens.
  const details = props.defer ? buildDetails : createMemo(buildDetails)
  // A <Show>, not a plain `if`: inBody() tracks the visibility toggle, which can
  // flip after mount (Settings), so the branch must stay reactive.
  return (
    <Show
      when={"children" in props || inBody()}
      fallback={
        <Base
          {...props}
          trigger={trigger()}
          defaultOpen={initial()}
          retainDetails={props.defer}
          onOpenChange={change}
        />
      }
    >
      <Base
        {...props}
        trigger={trigger()}
        defaultOpen={initial()}
        retainDetails={props.defer}
        onOpenChange={change}
        hasDetails={inBody()}
      >
        {details()}
      </Base>
    </Show>
  )
}
