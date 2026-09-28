import { createMemo, Show } from "solid-js"
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

// Cards that have mounted open at least once. Only gates the deferred body on
// remount; never read as an open preference.
const MOUNTED_MAX = 2000
const mounted = new Set<string>()
function remember(key: string | undefined) {
  if (!key) return
  if (!mounted.has(key) && mounted.size >= MOUNTED_MAX) {
    const first = mounted.values().next().value
    if (first) mounted.delete(first)
  }
  mounted.add(key)
}

export function initialOpen(props: OpenProps) {
  return props.forceOpen ? true : readToolOpen(toolOpenKey(props), props.defaultOpen)
}

// Persist an open state decided outside the trigger (auto-open) so a remount
// (virtualizer handoff, session switch) restores it instead of re-deriving.
export function rememberOpen(props: OpenProps, open: boolean) {
  writeToolOpen(toolOpenKey(props), open)
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
  // A deferred card that mounts open paints one frame without its body (the
  // trigger only, about 24px) and grows to full size a frame later. On the
  // first mount that is a cheap streaming trade-off. On a remount (virtualizer
  // handoff, scrolling back into range) it is a collapse-and-expand flash of
  // the full diff height that moves the pinned transcript, shifts the
  // virtualizer's range and can remount the row again in a loop. Track cards
  // that already mounted open, separately from the user preference map so the
  // display setting and search `forceOpen` are not turned into a preference,
  // and mount the body in the same frame when such a card comes back open.
  const id = key()
  // Captured before the card is remembered so the first mount stays deferred.
  const remount = id !== undefined && mounted.has(id)
  if (initial() && !props.forceOpen) remember(id)
  const defer = () => props.defer && !(remount && initial())
  const approval = useToolApproval()
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
  const details = defer() ? buildDetails : createMemo(buildDetails)
  // A <Show>, not a plain `if`: inBody() tracks the visibility toggle, which can
  // flip after mount (Settings), so the branch must stay reactive.
  return (
    <Show
      when={"children" in props || inBody()}
      fallback={
        <Base {...props} defer={defer()} defaultOpen={initial()} retainDetails={props.defer} onOpenChange={change} />
      }
    >
      <Base
        {...props}
        defer={defer()}
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
