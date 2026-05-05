/**
 * ThinkingSelector component
 * Popover-based dropdown for choosing a thinking effort variant.
 * Only rendered when the selected model supports reasoning variants.
 *
 * ThinkingSelectorBase — reusable core that accepts variants/value/onSelect props.
 * ThinkingSelector     — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, For, onCleanup, Show } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface ThinkingSelectorBaseProps {
  /** Available variant names (e.g. ["low","medium","high"]) */
  variants: string[]
  /** Currently selected variant */
  value: string | undefined
  /** Called when the user picks a variant */
  onSelect: (value: string) => void
}

export const ThinkingSelectorBase: Component<ThinkingSelectorBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  let listRef: HTMLDivElement | undefined

  function focusItem(idx: number) {
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items) return
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    setFocused(clamped)
    items[clamped]?.focus()
  }

  function refocus() {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  }

  function onOpen(val: boolean) {
    setOpen(val)
    if (val) {
      const idx = props.variants.findIndex((v) => v === props.value)
      requestAnimationFrame(() => focusItem(idx >= 0 ? idx : 0))
      return
    }
    refocus()
  }

  const onTrigger = () => {
    if (props.variants.length === 0) return
    onOpen(true)
  }
  window.addEventListener("openVariantPicker", onTrigger)
  onCleanup(() => window.removeEventListener("openVariantPicker", onTrigger))

  function pick(value: string) {
    props.onSelect(value)
    onOpen(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    const len = props.variants.length
    const cur = focused()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusItem((cur + 1) % len)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      focusItem((cur - 1 + len) % len)
      return
    }
    if (e.key === "Home") {
      e.preventDefault()
      focusItem(0)
      return
    }
    if (e.key === "End") {
      e.preventDefault()
      focusItem(len - 1)
      return
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(props.variants[cur])
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onOpen(false)
    }
  }

  const label = () => {
    const v = props.value
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : ""
  }

  return (
    <Show when={props.variants.length > 0}>
      <PopupSelector
        expanded={false}
        placement="top-start"
        preferredWidth={180}
        minHeight={100}
        open={open()}
        onOpenChange={onOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small" }}
        trigger={
          <>
            <span class="thinking-selector-trigger-label">{label()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        {(bodyH) => (
          <div
            class="thinking-selector-list"
            role="listbox"
            ref={listRef}
            onKeyDown={onKeyDown}
            style={bodyH() !== undefined ? { "max-height": `${bodyH()}px` } : {}}
          >
            <For each={props.variants}>
              {(v, i) => (
                <div
                  class={`thinking-selector-item${props.value === v ? " selected" : ""}`}
                  role="option"
                  aria-selected={props.value === v}
                  tabindex={focused() === i() ? 0 : -1}
                  onClick={() => pick(v)}
                  onFocus={() => setFocused(i())}
                >
                  <span class="thinking-selector-item-name">{v.charAt(0).toUpperCase() + v.slice(1)}</span>
                </div>
              )}
            </For>
          </div>
        )}
      </PopupSelector>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible)
// ---------------------------------------------------------------------------

export const ThinkingSelector: Component = () => {
  const session = useSession()

  return (
    <ThinkingSelectorBase
      variants={session.variantList()}
      value={session.currentVariant()}
      onSelect={(value) => session.selectVariant(value)}
    />
  )
}
