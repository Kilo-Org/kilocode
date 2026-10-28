/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModeSwitcherBase — reusable core that accepts agents/value/onSelect props. The v2 chat binding is in
 * v2/selectors.tsx.
 */

import { Component, createEffect, createSignal, onCleanup, For, Show } from "solid-js"
import type { AgentInfo } from "@opencode/client"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { isEnterKeyCommitNotIme } from "../../utils/ime-enter"
import { createTypeahead, isTypeaheadChar } from "../../utils/typeahead"

/**
 * v2 agents carry their display name in `name`; `id` is the value the server stores. An agent without a display name
 * has `name` equal to `id`, and as v1 its slug is title-cased.
 */
function formatAgentLabel(agent: AgentInfo): string {
  if (agent.name !== agent.id) return agent.name
  return agent.id
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

// ---------------------------------------------------------------------------
// Reusable base component
// ---------------------------------------------------------------------------

export interface ModeSwitcherBaseProps {
  /** Available agents to pick from */
  agents: AgentInfo[]
  /** Currently selected agent ID */
  value: string
  /** Called when the user picks an agent */
  onSelect: (id: string) => void
  /** Render inline instead of through a portal when nested in a dialog. */
  portal?: boolean
  /** Delay outside dismissal while the popover opens inside a dialog. */
  deferDismiss?: boolean
  /** Only respond to picker events from this prompt scope. */
  trigger?: string
  /** Disable this prompt-scoped selector while a permission owns the prompt. */
  blocked?: boolean
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  let listRef: HTMLDivElement | undefined
  // True while the picker was opened by the slash command rather than a click,
  // so dismissal returns focus to the prompt like the model/variant pickers.
  let slash = false

  // Listen for slash command trigger
  const onTrigger = (event: Event) => {
    const source = (event as CustomEvent<{ source?: string }>).detail?.source
    if (source !== props.trigger || props.blocked) return
    slash = true
    openSelected()
  }
  createEffect(() => {
    if (props.blocked) {
      setOpen(false)
      slash = false
      return
    }
    window.addEventListener("openModePicker", onTrigger)
    onCleanup(() => window.removeEventListener("openModePicker", onTrigger))
  })

  const hasAgents = () => props.agents.length > 1

  function pick(name: string) {
    props.onSelect(name)
    setOpen(false)
  }

  function focusItem(idx: number) {
    const items = listRef?.querySelectorAll<HTMLElement>("[role=option]")
    if (!items) return
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    setFocused(clamped)
    items[clamped]?.focus()
  }

  const typeahead = createTypeahead(() => props.agents.map(formatAgentLabel))

  function openSelected() {
    if (props.blocked) return
    const idx = props.agents.findIndex((a) => a.id === props.value)
    setFocused(idx >= 0 ? idx : 0)
    typeahead.reset()
    setOpen(true)
  }

  function onOpen(val: boolean) {
    if (val) {
      if (props.blocked) return
      // A click on the trigger opens without the slash flag.
      slash = false
      openSelected()
      return
    }
    setOpen(false)
    if (slash) {
      slash = false
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const len = props.agents.length
    const cur = focused()
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusItem((cur + 1) % len)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      focusItem((cur - 1 + len) % len)
    } else if (e.key === "Home") {
      e.preventDefault()
      focusItem(0)
    } else if (e.key === "End") {
      e.preventDefault()
      focusItem(len - 1)
    } else if (e.key === " " && typeahead.active()) {
      e.preventDefault()
      const idx = typeahead.type(e.key)
      if (idx >= 0) focusItem(idx)
    } else if (e.key === " " || isEnterKeyCommitNotIme(e)) {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(props.agents[cur].id)
    } else if (isTypeaheadChar(e)) {
      const idx = typeahead.type(e.key)
      if (idx >= 0) {
        e.preventDefault()
        focusItem(idx)
      }
    }
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.id === props.value)
    if (agent) return formatAgentLabel(agent)
    return props.value || "Code"
  }

  return (
    <Show when={hasAgents()}>
      <PopupSelector
        expanded={false}
        placement="top-start"
        minHeight={100}
        portal={props.portal}
        deferDismiss={props.deferDismiss}
        open={open()}
        onOpenChange={onOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small", disabled: props.blocked }}
        trigger={
          <>
            {/* Keyed so the label remounts on change and the prompt pill can animate it. */}
            <Show when={triggerLabel()} keyed>
              {(label) => <span class="mode-switcher-trigger-label">{label}</span>}
            </Show>
            <svg
              class="selector-trigger-chevron"
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ "flex-shrink": "0" }}
            >
              <path d="M8 4l4 5H4l4-5z" />
            </svg>
          </>
        }
      >
        {(bodyH) => (
          <div
            class="mode-switcher-list"
            role="listbox"
            ref={listRef}
            onKeyDown={onKeyDown}
            style={bodyH() !== undefined ? { "max-height": `${bodyH()}px` } : {}}
          >
            <For each={props.agents}>
              {(agent, i) => (
                <div
                  class={`mode-switcher-item${agent.id === props.value ? " selected" : ""}`}
                  role="option"
                  aria-selected={agent.id === props.value}
                  tabindex={focused() === i() ? 0 : -1}
                  data-autofocus={focused() === i() ? "" : undefined}
                  onClick={() => pick(agent.id)}
                  onFocus={() => setFocused(i())}
                >
                  <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                    <span class="mode-switcher-item-name">{formatAgentLabel(agent)}</span>
                  </div>
                  <Show when={agent.description}>
                    <span class="mode-switcher-item-desc">{agent.description}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        )}
      </PopupSelector>
    </Show>
  )
}
