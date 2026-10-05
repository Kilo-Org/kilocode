import { createMemo, createSignal, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { checksum } from "@opencode-ai/core/util/encode"
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
  revision?: unknown
  approvalPlacement?: "body" | "hidden"
}

type OpenProps = Pick<BasicToolProps, "tool" | "callID" | "partID" | "forceOpen" | "defaultOpen">

// Cards that have mounted open at least once. Only gates the deferred body on
// remount; never read as an open preference.
const MOUNTED_MAX = 2000
const mounted = new Set<string>()
const heights = new Map<
  string,
  { size: NonNullable<BaseProps["deferredSize"]>; revision: string | undefined; approval: boolean; status: BaseProps["status"] }
>()
function remember(key: string | undefined) {
  if (!key) return
  if (!mounted.has(key) && mounted.size >= MOUNTED_MAX) {
    const first = mounted.values().next().value
    if (first) {
      mounted.delete(first)
      heights.delete(first)
    }
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
  const approval = useToolApproval()
  const inBody = () => shouldRenderApprovalInBody(props.approvalPlacement, approval() !== undefined)
  // A deferred card that mounts open paints one frame without its body (the
  // trigger only, about 24px) and grows to full size a frame later. On the
  // first mount that is a cheap streaming trade-off. On a remount it is a
  // collapse-and-expand flash that shifts the virtualizer's range. Track cards
  // that already mounted open, separately from the user preference map, so a
  // remount can reserve its measured height without persisting display or
  // search state as a user preference.
  const id = key()
  // Captured before the card is remembered so the first mount stays deferred.
  const remount = id !== undefined && mounted.has(id)
  // Fingerprint the patch/content instead of retaining the full string so a
  // long-lived cache cannot pin large diff payloads.
  const revision = createMemo(() => {
    const value = props.revision
    if (typeof value === "string") return checksum(value)
    return value == null ? undefined : String(value)
  })
  const cached = remount && id ? heights.get(id) : undefined
  const size =
    cached && cached.revision === revision() && cached.status === props.status && cached.approval === inBody()
      ? cached.size
      : undefined
  if (initial() && !props.forceOpen) remember(id)
  // Reserve the last measured details height while remounting through the
  // deferred queue. Fall back to the eager path until a height is available.
  const defer = () => props.defer && !(remount && initial() && size == null)
  const change = (open: boolean) => {
    writeToolOpen(key(), open)
    if (open && !props.forceOpen) remember(key())
    props.onOpenChange?.(open)
  }
  // Renders after the body/tool list, not before — it's context about what
  // happened, not part of the header.
  const [body, setBody] = createSignal<HTMLDivElement>()
  createResizeObserver(body, (rect) => {
    const el = body()
    const content = el?.parentElement
    if (!id || !props.defer || !mounted.has(id) || !initial() || !content || rect.height <= 0) return
    heights.set(id, {
      size: { height: rect.height, width: content.getBoundingClientRect().width, font: getComputedStyle(content).font },
      revision: revision(),
      status: props.status,
      approval: inBody(),
    })
  })
  const buildDetails = () => (
    <div ref={setBody} data-slot="basic-tool-details">
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
        <Base
          {...props}
          defer={defer()}
          deferredSize={size}
          defaultOpen={initial()}
          retainDetails={props.defer}
          onOpenChange={change}
        />
      }
    >
      <Base
        {...props}
        defer={defer()}
        deferredSize={size}
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
