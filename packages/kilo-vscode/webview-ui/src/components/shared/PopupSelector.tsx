/**
 * PopupSelector — a Popover wrapper that automatically fits itself within the
 * underlying panel. Sizing logic is centralised here so any popup-style
 * selector can reuse it without duplicating the measurement code.
 *
 * Usage:
 *   <PopupSelector expanded={expanded()} open={open()} onOpenChange={setOpen} ...>
 *     {(bodyH) => <div style={{ height: `${bodyH()}px` }}>…</div>}
 *   </PopupSelector>
 */

import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
  splitProps,
  type ValidComponent,
} from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import type { PopoverProps } from "@kilocode/kilo-ui/popover"

export interface PopupSelectorProps<T extends ValidComponent = ValidComponent> extends Omit<
  PopoverProps<T>,
  "style" | "children"
> {
  /** Whether the selector is in expanded mode (wider + taller). */
  expanded: boolean
  /** Preferred width when collapsed. Default: 250 */
  preferredWidth?: number
  /** Preferred width when expanded. Default: 350 */
  preferredExpandedWidth?: number
  /** Body height when collapsed. Default: 300 */
  preferredHeight?: number
  /** Body height when expanded. Default: 600 */
  preferredExpandedHeight?: number
  /** Gap kept between popup edges and panel edges. Default: 8 */
  padding?: number
  /** Minimum popup width — never shrinks below this. Default: 100 */
  minWidth?: number
  /** Minimum popup height — never shrinks below this. Default: 100 */
  minHeight?: number
  /** Render prop — receives a reactive `bodyH` accessor (undefined when no preferred height set). */
  children: (bodyH: Accessor<number | undefined>) => JSXElement
}

export function PopupSelector<T extends ValidComponent = ValidComponent>(props: PopupSelectorProps<T>) {
  const [local, rest] = splitProps(props, [
    "expanded",
    "preferredWidth",
    "preferredExpandedWidth",
    "preferredHeight",
    "preferredExpandedHeight",
    "padding",
    "minWidth",
    "minHeight",
    "children",
  ])

  // Width uses clientWidth because the popup's horizontal constraint is always
  // the full viewport — it can be as wide as (clientWidth - padding) regardless
  // of where the trigger sits horizontally.
  const [panelW, setPanelW] = createSignal(document.documentElement.clientWidth)

  // Height cannot use clientHeight the same way: available vertical space depends
  // on where the trigger is. A trigger near the bottom may have only 200px above
  // it even in a 700px viewport. Kobalte's floating-ui size middleware measures
  // the actual space in the positioned direction and stores it as
  // --kb-popper-content-available-height on the content element — that is the
  // correct source of truth, read via rAF after positioning completes.
  const [panelH, setPanelH] = createSignal<number | undefined>(undefined)

  createEffect(() => {
    if (!rest.open) return

    setPanelW(document.documentElement.clientWidth)

    const id = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>("[data-component='popover-content']")
      if (!el) return
      const raw = getComputedStyle(el).getPropertyValue("--kb-popper-content-available-height")
      const val = parseFloat(raw)
      if (!isNaN(val)) setPanelH(val)
    })
    onCleanup(() => cancelAnimationFrame(id))
  })

  const popoverW = createMemo(() => {
    const preferred = local.expanded ? local.preferredExpandedWidth : local.preferredWidth
    const pad = local.padding ?? 8
    const max = panelW() - pad * 2
    if (preferred === undefined) return { max }
    return { width: Math.max(local.minWidth ?? 100, Math.min(preferred, max)), max }
  })

  const bodyH = createMemo(() => {
    const preferred = local.expanded ? local.preferredExpandedHeight : local.preferredHeight
    if (preferred === undefined) return undefined
    const h = panelH()
    if (h === undefined) return preferred
    // 26px = 2px border + 24px popover-body padding (12px top + 12px bottom)
    const max = h - 26
    return Math.max(local.minHeight ?? 100, Math.min(preferred, max))
  })

  return (
    <Popover
      placement="top-start"
      slide={true}
      overflowPadding={local.padding ?? 8}
      {...(rest as PopoverProps)}
      style={
        popoverW().width !== undefined
          ? { width: `${popoverW().width}px`, "max-width": `${popoverW().max}px` }
          : { "max-width": `${popoverW().max}px` }
      }
    >
      {local.children(bodyH)}
    </Popover>
  )
}
