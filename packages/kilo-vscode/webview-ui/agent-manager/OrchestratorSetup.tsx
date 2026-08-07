/** @jsxImportSource solid-js */

import { For, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"

export type OrchestratorPolicy = "Autonomous" | "Supervised" | "Manual"

export interface OrchestratorConfig {
  goal: string
  lead: string
  route: string
  policy: OrchestratorPolicy
  budget: number
  concurrency: number
  isolated: boolean
  contracts: boolean
  publish: boolean
}

interface SetupProps {
  config: OrchestratorConfig
  onChange: (config: OrchestratorConfig) => void
  onBack: () => void
  onStart: () => void
}

interface StartProps {
  goal: string
  onGoal: (goal: string) => void
  onConfigure: () => void
  onStart: () => void
}

const leads = [
  { value: "sonnet", label: "Claude Sonnet 4.6", detail: "High capability" },
  { value: "gpt", label: "GPT-5.6", detail: "High capability" },
  { value: "router", label: "Auto router", detail: "Route the lead" },
]

const routes = [
  { value: "balanced", label: "Auto · balanced", detail: "Cost and quality" },
  { value: "economy", label: "Auto · economy", detail: "Prefer cheaper models" },
  { value: "quality", label: "Auto · quality", detail: "Prefer stronger models" },
  { value: "k3", label: "K3 only", detail: "Pin every worker" },
]

const policies: OrchestratorPolicy[] = ["Autonomous", "Supervised", "Manual"]

export const OrchestratorStart: Component<StartProps> = (props) => (
  <div class="am-orch-start">
    <div class="am-orch-start-icon">
      <Icon name="organization" size="large" />
    </div>
    <h1>Coordinate a larger task</h1>
    <p>Give one lead agent a goal. It can plan, route bounded work to cheaper models, and bring decisions back here.</p>
    <label class="am-orch-goal-input">
      <span>Goal</span>
      <textarea
        value={props.goal}
        onInput={(event) => props.onGoal(event.currentTarget.value)}
        placeholder="Describe the outcome, constraints, and what requires your approval..."
        rows={5}
      />
    </label>
    <div class="am-orch-start-actions">
      <Button variant="primary" size="large" disabled={!props.goal.trim()} onClick={props.onConfigure}>
        Configure run
      </Button>
      <Button variant="secondary" size="large" disabled={!props.goal.trim()} onClick={props.onStart}>
        Start with defaults
      </Button>
    </div>
    <div class="am-orch-defaults">
      <span>Defaults</span>
      <span>Supervised</span>
      <span>Auto route workers</span>
      <span>3 concurrent</span>
      <span>Isolated worktrees</span>
    </div>
  </div>
)

export const OrchestratorSetup: Component<SetupProps> = (props) => {
  const update = <K extends keyof OrchestratorConfig>(key: K, value: OrchestratorConfig[K]) => {
    props.onChange({ ...props.config, [key]: value })
  }

  return (
    <div class="am-orch-configure">
      <header>
        <Button variant="ghost" size="small" icon="arrow-left" onClick={props.onBack}>
          Back
        </Button>
        <div>
          <h1>Configure orchestration</h1>
          <p>Set the envelope. The lead can replan freely inside it.</p>
        </div>
      </header>

      <div class="am-orch-config-grid">
        <section class="am-orch-config-main">
          <label class="am-orch-field am-orch-field-goal">
            <span>Goal</span>
            <textarea
              value={props.config.goal}
              onInput={(event) => update("goal", event.currentTarget.value)}
              rows={4}
            />
          </label>

          <div class="am-orch-field-grid">
            <label class="am-orch-field">
              <span>Lead model</span>
              <small>Keeps the plan and synthesis context.</small>
              <Select
                options={leads}
                current={leads.find((item) => item.value === props.config.lead)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && update("lead", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </label>
            <label class="am-orch-field">
              <span>Worker routing</span>
              <small>Workers use separate model contexts.</small>
              <Select
                options={routes}
                current={routes.find((item) => item.value === props.config.route)}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => item && update("route", item.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </label>
          </div>

          <fieldset class="am-orch-policy-field">
            <legend>Control policy</legend>
            <div class="am-orch-policy-options">
              <For each={policies}>
                {(policy) => (
                  <button
                    classList={{ active: props.config.policy === policy }}
                    onClick={() => update("policy", policy)}
                  >
                    <strong>{policy}</strong>
                    <small>
                      {policy === "Autonomous"
                        ? "Act within limits"
                        : policy === "Supervised"
                          ? "Pause at gates"
                          : "Approve each move"}
                    </small>
                  </button>
                )}
              </For>
            </div>
          </fieldset>

          <div class="am-orch-number-grid">
            <label class="am-orch-field">
              <span>Run budget</span>
              <div class="am-orch-number-input">
                <span>$</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={props.config.budget}
                  onInput={(event) => update("budget", Number(event.currentTarget.value))}
                />
              </div>
            </label>
            <label class="am-orch-field">
              <span>Max concurrent workers</span>
              <div class="am-orch-number-input">
                <input
                  type="number"
                  min="1"
                  max="8"
                  step="1"
                  value={props.config.concurrency}
                  onInput={(event) => update("concurrency", Number(event.currentTarget.value))}
                />
              </div>
            </label>
          </div>
        </section>

        <aside class="am-orch-config-side">
          <section>
            <h2>Execution</h2>
            <label class="am-orch-switch-row">
              <span>
                <strong>Isolated worktrees</strong>
                <small>Use durable branches for implementation.</small>
              </span>
              <Switch
                checked={props.config.isolated}
                onChange={(value: boolean) => update("isolated", value)}
                hideLabel
              >
                Isolated worktrees
              </Switch>
            </label>
          </section>
          <section>
            <h2>Approval gates</h2>
            <label class="am-orch-switch-row">
              <span>
                <strong>Public contract changes</strong>
                <small>Pause before changing APIs or schemas.</small>
              </span>
              <Switch
                checked={props.config.contracts}
                onChange={(value: boolean) => update("contracts", value)}
                hideLabel
              >
                Contract changes
              </Switch>
            </label>
            <label class="am-orch-switch-row">
              <span>
                <strong>Push or publish</strong>
                <small>Pause before external side effects.</small>
              </span>
              <Switch checked={props.config.publish} onChange={(value: boolean) => update("publish", value)} hideLabel>
                Push or publish
              </Switch>
            </label>
          </section>
          <section class="am-orch-estimate">
            <h2>Expected run</h2>
            <dl>
              <div>
                <dt>Workers</dt>
                <dd>3–5</dd>
              </div>
              <div>
                <dt>Worktrees</dt>
                <dd>{props.config.isolated ? "As needed" : "Off"}</dd>
              </div>
              <div>
                <dt>Estimated cost</dt>
                <dd>$1.80–${props.config.budget.toFixed(2)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <footer>
        <span>Nothing starts until you confirm.</span>
        <Button variant="primary" size="large" disabled={!props.config.goal.trim()} onClick={props.onStart}>
          Start orchestration
        </Button>
      </footer>
    </div>
  )
}

interface ControlsProps {
  config: OrchestratorConfig
  onChange: (config: OrchestratorConfig) => void
}

export const OrchestratorControls: Component<ControlsProps> = (props) => {
  const update = <K extends keyof OrchestratorConfig>(key: K, value: OrchestratorConfig[K]) => {
    props.onChange({ ...props.config, [key]: value })
  }

  return (
    <div class="am-orch-controls">
      <section>
        <h2>Control policy</h2>
        <div class="am-orch-control-policies">
          <For each={policies}>
            {(policy) => (
              <button classList={{ active: props.config.policy === policy }} onClick={() => update("policy", policy)}>
                {policy}
              </button>
            )}
          </For>
        </div>
        <p>Changes apply to new assignments and replans.</p>
      </section>
      <section>
        <h2>Run envelope</h2>
        <label class="am-orch-live-number">
          <span>Budget ceiling</span>
          <div>
            <span>$</span>
            <input
              type="number"
              min="1"
              max="50"
              value={props.config.budget}
              onInput={(event) => update("budget", Number(event.currentTarget.value))}
            />
          </div>
        </label>
        <label class="am-orch-live-number">
          <span>Concurrent workers</span>
          <input
            type="number"
            min="1"
            max="8"
            value={props.config.concurrency}
            onInput={(event) => update("concurrency", Number(event.currentTarget.value))}
          />
        </label>
      </section>
      <section>
        <h2>Approval gates</h2>
        <label class="am-orch-switch-row">
          <span>
            <strong>Contract changes</strong>
            <small>Currently blocking phase 3.</small>
          </span>
          <Switch checked={props.config.contracts} onChange={(value: boolean) => update("contracts", value)} hideLabel>
            Contract changes
          </Switch>
        </label>
        <label class="am-orch-switch-row">
          <span>
            <strong>Push or publish</strong>
            <small>Require approval for external effects.</small>
          </span>
          <Switch checked={props.config.publish} onChange={(value: boolean) => update("publish", value)} hideLabel>
            Push or publish
          </Switch>
        </label>
      </section>
      <section class="am-orch-control-note">
        <Icon name="warning" size="small" />
        <p>Reducing limits will not interrupt active workers. Pause the run to stop new assignments immediately.</p>
      </section>
    </div>
  )
}
