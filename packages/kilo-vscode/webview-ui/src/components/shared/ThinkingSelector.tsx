/**
 * ThinkingSelector component
 * Popover-based dropdown for choosing a thinking effort variant.
 * Only rendered when the selected model supports reasoning variants.
 *
 * ThinkingSelectorBase — reusable core that accepts variants/value/onSelect props.
 * ThinkingSelector     — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
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

  function pick(value: string) {
    props.onSelect(value)
    setOpen(false)
    requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
  }

  const label = () => {
    const v = props.value
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : ""
  }

  return (
    <Show when={props.variants.length > 0}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={setOpen}
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
        <div class="thinking-selector-list" role="listbox">
          <For each={props.variants}>
            {(v) => (
              <div
                class={`thinking-selector-item${props.value === v ? " selected" : ""}`}
                role="option"
                aria-selected={props.value === v}
                onClick={() => pick(v)}
              >
                <span class="thinking-selector-item-name">{v.charAt(0).toUpperCase() + v.slice(1)}</span>
              </div>
            )}
          </For>
        </div>
      </Popover>
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
