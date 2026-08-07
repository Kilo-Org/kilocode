/** @jsxImportSource solid-js */

import { For, Show, createSignal, type Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import "./ultra-mode-prototype.css"

interface UltraModePrototypeProps {
  initialEnabled?: boolean
  initialOpen?: boolean
}

const leads = [
  { value: "sonnet", label: "Claude Sonnet 4.6" },
  { value: "gpt", label: "GPT-5.6" },
  { value: "router", label: "Auto router" },
]

const workers = [
  { value: "balanced", label: "Auto · balanced" },
  { value: "economy", label: "Auto · economy" },
  { value: "k3", label: "K3" },
  { value: "luna", label: "Luna" },
]

const policies = ["Autonomous", "Supervised", "Manual"] as const

export const UltraModePrototype: Component<UltraModePrototypeProps> = (props) => {
  const [enabled, setEnabled] = createSignal(props.initialEnabled ?? false)
  const [open, setOpen] = createSignal(props.initialOpen ?? false)
  const [lead, setLead] = createSignal("sonnet")
  const [worker, setWorker] = createSignal("balanced")
  const [agents, setAgents] = createSignal(3)
  const [policy, setPolicy] = createSignal<(typeof policies)[number]>("Supervised")
  const [isolated, setIsolated] = createSignal(true)

  const toggle = (value: boolean) => {
    setEnabled(value)
    setOpen(value)
  }

  const summary = () => `${agents()} · ${leads.find((item) => item.value === lead())?.label ?? "Lead"}`

  return (
    <div class="ultra-mode-control" classList={{ enabled: enabled(), open: open() }}>
      <div class="ultra-mode-bar">
        <button class="ultra-mode-summary" onClick={() => enabled() && setOpen((value) => !value)}>
          <Icon name="organization" size="small" />
          <strong>Ultra</strong>
          <Show when={enabled()}>
            <small>{summary()}</small>
          </Show>
          <Show when={enabled()}>
            <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          </Show>
        </button>
        <Switch checked={enabled()} onChange={toggle} hideLabel>
          Ultra Mode
        </Switch>
      </div>

      <Show when={enabled() && open()}>
        <div class="ultra-mode-panel">
          <div class="ultra-mode-fields">
            <label>
              <span>Lead</span>
              <Select
                options={leads}
                current={leads.find((item) => item.value === lead())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setLead(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </label>
            <label>
              <span>Workers</span>
              <Select
                options={workers}
                current={workers.find((item) => item.value === worker())}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && setWorker(item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </label>
            <label>
              <span>Agents</span>
              <div class="ultra-mode-stepper">
                <IconButton
                  icon="dash"
                  size="small"
                  variant="ghost"
                  aria-label="Remove agent"
                  disabled={agents() <= 2}
                  onClick={() => setAgents((value) => Math.max(2, value - 1))}
                />
                <strong>{agents()}</strong>
                <IconButton
                  icon="plus-small"
                  size="small"
                  variant="ghost"
                  aria-label="Add agent"
                  disabled={agents() >= 8}
                  onClick={() => setAgents((value) => Math.min(8, value + 1))}
                />
              </div>
            </label>
            <label>
              <span>Control</span>
              <select
                value={policy()}
                onChange={(event) => setPolicy(event.currentTarget.value as (typeof policies)[number])}
              >
                <For each={policies}>{(item) => <option value={item}>{item}</option>}</For>
              </select>
            </label>
          </div>

          <footer>
            <label>
              <Switch checked={isolated()} onChange={setIsolated} hideLabel>
                Worktrees
              </Switch>
              <span>Worktrees</span>
            </label>
            <button onClick={() => setOpen(false)}>Done</button>
          </footer>
        </div>
      </Show>
    </div>
  )
}
