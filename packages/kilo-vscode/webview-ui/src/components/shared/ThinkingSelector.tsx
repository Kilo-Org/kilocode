/**
 * ThinkingSelector component
 * Popover-based dropdown for choosing a thinking effort variant.
 * Only rendered when the selected model supports reasoning variants.
 *
 * ThinkingSelectorBase — reusable core that accepts variants/value/onSelect props.
 * ThinkingSelector     — thin wrapper wired to session context for chat usage.
 */

import { type Accessor, Component, createSignal, For, onCleanup, Show } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { createTypeahead, isTypeaheadChar } from "../../utils/typeahead"

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
  /** Called when the user clears selection via default row. */
  onClear?: () => void
  /** Include default/unset row at top. */
  allowClear?: boolean
  /** Label for default/unset row. */
  clearLabel?: string
  /** Popover placement — defaults to top-start. */
  placement?: "top-start" | "bottom-start" | "bottom-end" | "top-end"
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
  /** Delay outside dismissal while the popover opens inside a dialog. */
  deferDismiss?: boolean
  /** Listen for the global prompt trigger event. Defaults to true. */
  globalTrigger?: boolean
  /** Only respond to picker events from this prompt scope. */
  trigger?: string
  /** Show the Shift+Tab cycle hint in the trigger tooltip. */
  cycleHint?: boolean
  /** Accessible name for the selector trigger. */
  label?: string
}

export const ThinkingSelectorBase: Component<ThinkingSelectorBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  const language = useLanguage()
  let listRef: HTMLDivElement | undefined

  const rows = () => {
    if (props.variants.length === 0 && !props.value) return []
    return props.allowClear ? [undefined, ...props.variants] : props.variants
  }
  const clearLabel = () => props.clearLabel ?? "Not set"

  function display(value: string | undefined) {
    if (!value) return clearLabel()
    return value.charAt(0).toUpperCase() + value.slice(1)
  }

  function focusItem(idx: number) {
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items) return
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    setFocused(clamped)
    items[clamped]?.focus()
  }

  const typeahead = createTypeahead(() => rows().map(display))

  function refocus() {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  }

  function onOpen(val: boolean) {
    if (val) {
      const items = rows()
      const idx = items.findIndex((v) => v === props.value)
      setFocused(idx >= 0 ? idx : 0)
      typeahead.reset()
      setOpen(true)
      return
    }
    setOpen(false)
    refocus()
  }

  const onTrigger = (event: Event) => {
    const source = (event as CustomEvent<{ source?: string }>).detail?.source
    if (source !== props.trigger) return
    if (rows().length === 0) return
    onOpen(true)
  }
  if (props.globalTrigger ?? true) {
    window.addEventListener("openVariantPicker", onTrigger)
    onCleanup(() => window.removeEventListener("openVariantPicker", onTrigger))
  }

  function pick(value: string | undefined) {
    if (value === undefined) {
      props.onClear?.()
      onOpen(false)
      return
    }
    props.onSelect(value)
    onOpen(false)
  }

  function onKeyDown(e: KeyboardEvent) {
    const items = rows()
    const len = items.length
    const cur = focused()
    if (len === 0) return
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
    if (e.key === " " && typeahead.active()) {
      e.preventDefault()
      const idx = typeahead.type(e.key)
      if (idx >= 0) focusItem(idx)
      return
    }
    if (e.key === " " || isEnterKeyCommitNotIme(e)) {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(items[cur])
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onOpen(false)
      return
    }
    if (isTypeaheadChar(e)) {
      const idx = typeahead.type(e.key)
      if (idx >= 0) {
        e.preventDefault()
        focusItem(idx)
      }
    }
  }

  return (
    <Show when={rows().length > 0}>
      <Tooltip
        value={
          <div data-slot="tooltip-keybind">
            <span>{language.t("prompt.thinking.tooltip")}</span>
            <Show when={props.cycleHint}>
              <span data-slot="tooltip-keybind-key">Shift+Tab</span>
            </Show>
          </div>
        }
        placement="top"
        openDelay={0}
      >
        <PopupSelector
          expanded={false}
          placement={props.placement ?? "top-start"}
          preferredWidth={180}
          minHeight={100}
          portal={props.portal}
          deferDismiss={props.deferDismiss}
          open={open()}
          onOpenChange={onOpen}
          triggerAs={Button}
          triggerProps={{ variant: "ghost", size: "small", "aria-label": props.label }}
          trigger={
            <>
              <span class="thinking-selector-trigger-label">{display(props.value)}</span>
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
              <For each={rows()}>
                {(v, i) => (
                  <div
                    class={`thinking-selector-item${props.value === v ? " selected" : ""}`}
                    role="option"
                    aria-selected={props.value === v}
                    tabindex={focused() === i() ? 0 : -1}
                    data-autofocus={focused() === i() ? "" : undefined}
                    onClick={() => pick(v)}
                    onFocus={() => setFocused(i())}
                  >
                    <span class="thinking-selector-item-name">{display(v)}</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </PopupSelector>
      </Tooltip>
    </Show>
  )
}

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible)
// ---------------------------------------------------------------------------

interface ThinkingSelectorProps {
  sessionID?: Accessor<string | undefined>
}

export const ThinkingSelector: Component<ThinkingSelectorProps> = (props) => {
  const session = useSession()
  const { settings } = useConfig()
  const language = useLanguage()
  const id = () => props.sessionID?.()

  return (
    <ThinkingSelectorBase
      variants={session.variantList(id())}
      value={session.currentVariant(id())}
      onSelect={(value) => session.selectVariant(value, id())}
      onClear={() => session.selectVariant(undefined, id())}
      allowClear
      clearLabel={language.t("common.default")}
      cycleHint={settings()["chat.shiftTabCyclesVariant"] !== false}
    />
  )
}
