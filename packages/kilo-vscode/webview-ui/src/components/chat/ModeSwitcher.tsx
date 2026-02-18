/**
 * ModeSwitcher component
 * Popover-based selector for choosing an agent/mode in the chat prompt area.
 * Uses kilo-ui Popover component (Phase 4.5 of UI implementation plan).
 *
 * ModeSwitcherBase — reusable core that accepts agents/value/onSelect props.
 * ModeSwitcher     — thin wrapper wired to session context for chat usage.
 */

import { Component, createSignal, For, Show } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Button } from "@kilocode/kilo-ui/button"
import { useSession } from "../../context/session"
import type { AgentInfo } from "../../types/messages"

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

  const hasAgents = () => props.agents.length > 1

  function pick(name: string) {
    props.onSelect(name)
    setOpen(false)
  }

  const triggerLabel = () => {
    const agent = props.agents.find((a) => a.name === props.value)
    if (agent) {
      return agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
    }
    return props.value || "Code"
  }

  return (
    <Show when={hasAgents()}>
      <Popover
        placement="top-start"
        open={open()}
        onOpenChange={setOpen}
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
        <div class="mode-switcher-list" role="listbox">
          <For each={props.agents}>
            {(agent) => (
              <div
                class={`mode-switcher-item${agent.name === props.value ? " selected" : ""}`}
                role="option"
                aria-selected={agent.name === props.value}
                onClick={() => pick(agent.name)}
              >
                <span class="mode-switcher-item-name">{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}</span>
                <Show when={agent.description}>
                  <span class="mode-switcher-item-desc">{agent.description}</span>
                </Show>
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

export const ModeSwitcher: Component = () => {
  const session = useSession()

  return <ModeSwitcherBase agents={session.agents()} value={session.selectedAgent()} onSelect={session.selectAgent} />
}
