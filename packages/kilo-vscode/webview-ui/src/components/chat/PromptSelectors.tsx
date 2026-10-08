/**
 * PromptSelectors - agent, model, and reasoning as one split control.
 *
 * Each segment is the existing selector, so its popover, slash command, and
 * keyboard shortcuts do not change. The group adds:
 * - Menu bar behavior: while one popover is open, moving the pointer onto
 *   another segment opens that segment instead.
 * - Left and Right arrows move focus between segments.
 * - Reasoning collapses before the model name truncates (`data-tight`), and a
 *   changed reasoning value peeks out for a moment (`data-peek`).
 */

import { type Accessor, Component, onCleanup, onMount } from "solid-js"
import { ModeSwitcher } from "../shared/ModeSwitcher"
import { ModelSelector } from "../shared/ModelSelector"
import { ThinkingSelector } from "../shared/ThinkingSelector"
import { FOLD_RESERVE } from "./prompt-fold"

interface Props {
  sessionID: Accessor<string | undefined>
  blocked: boolean
  hint?: { title: string; keybind: string }
}

const TRIGGER = "[data-slot='popover-trigger']"
const PEEK = 1500
/** Covers the toolbar gaps the fold math leaves out, so the cap stays below the real space. */
const FOLD_MARGIN = 8

function triggers(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(`.prompt-selector ${TRIGGER}`)).filter(
    (el) => !el.disabled,
  )
}

/**
 * True when the pill with the full model and reasoning labels does not fit.
 * The room is the pill width now plus the free space in the toolbar. It does
 * not change when the reasoning label collapses, so the result cannot
 * oscillate.
 *
 * While prompt actions are folded, the room is capped to the space the fold
 * keeps for the pill. At each fold step the pill gets exactly that space, and
 * only the space between two steps is larger. Without the cap the label would
 * show in that space and collapse again when the next action unfolds. With the
 * cap the order is the same in both directions: actions unfold first, then the
 * reasoning label shows.
 */
function tight(root: HTMLElement) {
  const model = root.querySelector<HTMLElement>(".model-selector-trigger-label")
  const level = root.querySelector<HTMLElement>(".thinking-selector-trigger-label")
  const hint = root.parentElement
  if (!model || !level || !hint) return false
  const button = level.parentElement
  const gap = button ? parseFloat(getComputedStyle(button).columnGap) || 0 : 0
  const used = level.getBoundingClientRect().width + gap + (parseFloat(getComputedStyle(level).marginRight) || 0)
  const box = getComputedStyle(hint)
  const inner = hint.clientWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight)
  const others = Array.from(hint.children).reduce(
    (sum, el) => sum + (el === root ? 0 : el.getBoundingClientRect().width),
    0,
  )
  const gaps = (parseFloat(box.columnGap) || 0) * Math.max(0, hint.children.length - 1)
  const width = root.getBoundingClientRect().width
  const free = Math.max(0, inner - gaps - others - width)
  const folded = !!hint.querySelector(".prompt-input-hint-actions > .prompt-action:first-child:not([data-folded])")
  const room = folded ? Math.min(width + free, FOLD_RESERVE - FOLD_MARGIN) : width + free
  const need = width - used - model.clientWidth + model.scrollWidth + level.scrollWidth + gap
  return need > room + 1
}

export const PromptSelectors: Component<Props> = (props) => {
  let root: HTMLDivElement | undefined

  onMount(() => {
    const el = root
    if (!el) return
    const state = {
      frame: 0,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      label: null as Element | null,
    }
    const fit = () => {
      state.frame = 0
      el.toggleAttribute("data-tight", tight(el))
    }
    const schedule = () => {
      if (!state.frame) state.frame = requestAnimationFrame(fit)
    }
    const peek = () => {
      const label = el.querySelector(".thinking-selector-trigger-label")
      const prev = state.label
      state.label = label
      if (!label || !prev || label === prev) return
      el.setAttribute("data-peek", "")
      clearTimeout(state.timer)
      state.timer = setTimeout(() => el.removeAttribute("data-peek"), PEEK)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    if (el.parentElement) {
      resize.observe(el.parentElement)
      for (const child of Array.from(el.parentElement.children)) resize.observe(child)
    }
    const mutation = new MutationObserver(() => {
      peek()
      schedule()
    })
    mutation.observe(el, { childList: true, subtree: true, characterData: true })
    state.label = el.querySelector(".thinking-selector-trigger-label")
    schedule()
    onCleanup(() => {
      resize.disconnect()
      mutation.disconnect()
      clearTimeout(state.timer)
      cancelAnimationFrame(state.frame)
    })
  })

  const onPointerOver = (e: PointerEvent) => {
    if (!root || e.pointerType === "touch") return
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>(TRIGGER)
    if (!target || target.disabled || target.hasAttribute("data-expanded")) return
    const open = triggers(root).some((el) => el !== target && el.hasAttribute("data-expanded"))
    if (!open) return
    // The new popover takes focus, so the open one closes as an outside focus.
    // Wait one frame so the hover tooltip has opened first. Opening the popover
    // then closes it, the same as a click does.
    requestAnimationFrame(() => {
      if (!target.matches(":hover") || target.hasAttribute("data-expanded")) return
      target.click()
    })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!root || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
    const list = triggers(root)
    const idx = list.indexOf(e.target as HTMLButtonElement)
    if (idx < 0) return
    e.preventDefault()
    const step = e.key === "ArrowLeft" ? -1 : 1
    list[(idx + step + list.length) % list.length]?.focus()
  }

  return (
    <div class="prompt-selectors" ref={root} onPointerOver={onPointerOver} onKeyDown={onKeyDown}>
      <div class="prompt-selector" data-part="agent">
        <ModeSwitcher sessionID={props.sessionID} blocked={props.blocked} hint={props.hint} />
      </div>
      <div class="prompt-selector" data-part="model">
        <ModelSelector sessionID={props.sessionID} blocked={props.blocked} />
      </div>
      <div class="prompt-selector" data-part="variant">
        <ThinkingSelector sessionID={props.sessionID} blocked={props.blocked} />
      </div>
    </div>
  )
}
