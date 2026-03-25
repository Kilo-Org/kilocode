/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModeSwitcherBase — reusable core that accepts agents/value/onSelect props.
 * ModeSwitcher     — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, onCleanup, For, Show } from "solid-js"
import { PopupSelector } from "./PopupSelector"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import type { AgentInfo } from "../../types/messages"

/** Format an agent for display. Uses displayName if available, otherwise title-cases the slug. */
function formatAgentLabel(agent: AgentInfo): string {
  if (agent.displayName) return agent.displayName
  return agent.name
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
  /** Currently selected agent name */
  value: string
  /** Called when the user picks an agent */
  onSelect: (name: string) => void
}

export const ModeSwitcherBase: Component<ModeSwitcherBaseProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const [focused, setFocused] = createSignal(-1)
  let listRef: HTMLDivElement | undefined

  // Listen for slash command trigger
  const onTrigger = () => setOpen(true)
  window.addEventListener("openModePicker", onTrigger)
  onCleanup(() => window.removeEventListener("openModePicker", onTrigger))

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

  function onOpen(val: boolean) {
    setOpen(val)
    if (val) {
      const idx = props.agents.findIndex((a) => a.name === props.value)
      requestAnimationFrame(() => focusItem(idx >= 0 ? idx : 0))
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
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (cur >= 0 && cur < len) pick(props.agents[cur].name)
    }
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.name === props.value)
    if (agent) return formatAgentLabel(agent)
    return props.value || "Code"
  }

  return (
    <Show when={hasAgents()}>
      <PopupSelector
        expanded={false}
        placement="top-start"
        minHeight={100}
        open={open()}
        onOpenChange={onOpen}
        triggerAs={Button}
        triggerProps={{ variant: "ghost", size: "small" }}
        trigger={
          <>
            <span class="mode-switcher-trigger-label">{triggerLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ "flex-shrink": "0" }}>
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
                  class={`mode-switcher-item${agent.name === props.value ? " selected" : ""}`}
                  role="option"
                  aria-selected={agent.name === props.value}
                  tabindex={focused() === i() ? 0 : -1}
                  onClick={() => pick(agent.name)}
                  onFocus={() => setFocused(i())}
                >
                  <span class="mode-switcher-item-name">{formatAgentLabel(agent)}</span>
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

// ---------------------------------------------------------------------------
// Chat-specific wrapper (backwards-compatible)
// ---------------------------------------------------------------------------

export const ModeSwitcher: Component = () => {
  const session = useSession()

  return (
    <ModeSwitcherBase
      agents={session.agents()}
      value={session.selectedAgent()}
      onSelect={(name) => {
        session.selectAgent(name)
        requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
      }}
    />
  )
}
