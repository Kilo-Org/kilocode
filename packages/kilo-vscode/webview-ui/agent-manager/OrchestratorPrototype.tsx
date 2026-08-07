/** @jsxImportSource solid-js */

import { For, Show, createSignal, type Component, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { SidebarToggleButton } from "./SidebarToggleButton"
import {
  OrchestratorControls,
  OrchestratorSetup,
  OrchestratorStart,
  type OrchestratorConfig,
} from "./OrchestratorSetup"
import "./orchestrator-prototype.css"

export type OrchestratorStage = "start" | "configure" | "running"
type Inspector = "plan" | "controls" | "history"

interface OrchestratorPrototypeProps {
  children: JSX.Element
  initialStage?: OrchestratorStage
}

const phases = [
  { label: "Map retry failure modes", state: "complete", meta: "3 findings verified" },
  { label: "Build isolated candidates", state: "complete", meta: "2 worktrees" },
  { label: "Resolve idempotency evidence", state: "active", meta: "Needs input" },
  { label: "Run payment test matrix", state: "queued", meta: "Blocked by phase 3" },
  { label: "Synthesize recommendation", state: "queued", meta: "Not started" },
] as const

const workers = [
  { name: "Orchestrator", model: "Sonnet 4.6", state: "active", detail: "Revising the plan" },
  { name: "API candidate", model: "K3", state: "active", detail: "Worktree · 8 files" },
  { name: "Web candidate", model: "K3", state: "complete", detail: "Worktree · checks passed" },
  { name: "Verifier", model: "Terra", state: "attention", detail: "Retry race found" },
] as const

const history = [
  { time: "Now", title: "Plan revised", detail: "Added a contract decision before the test matrix.", icon: "fork" },
  {
    time: "2m",
    title: "Verifier raised a blocker",
    detail: "Lost responses can create duplicate payment intents.",
    icon: "warning",
  },
  { time: "5m", title: "Web candidate finished", detail: "Checks passed in checkout-web.", icon: "circle-check" },
  { time: "9m", title: "API worker promoted", detail: "Analysis moved into an isolated worktree.", icon: "branch" },
] as const

function StatusDot(props: { state: string }) {
  return <span class="am-orch-status-dot" data-state={props.state} />
}

export const OrchestratorPrototype: Component<OrchestratorPrototypeProps> = (props) => {
  const [stage, setStage] = createSignal<OrchestratorStage>(props.initialStage ?? "start")
  const [open, setOpen] = createSignal(true)
  const [view, setView] = createSignal<Inspector>("plan")
  const [paused, setPaused] = createSignal(false)
  const [stopped, setStopped] = createSignal(false)
  const [config, setConfig] = createSignal<OrchestratorConfig>({
    goal: "Make checkout retries safe without changing payment providers.",
    lead: "sonnet",
    route: "balanced",
    policy: "Supervised",
    budget: 4,
    concurrency: 3,
    isolated: true,
    contracts: true,
    publish: true,
  })

  const running = () => stage() === "running"
  const status = () => (stopped() ? "Stopped" : paused() ? "Paused" : "Running")

  return (
    <div class="am-layout am-orch-prototype">
      <aside class="am-sidebar am-orch-sidebar" style={{ width: "232px" }}>
        <div class="am-section-header">
          <span class="am-section-label">Project</span>
          <IconButton icon="plus" size="small" variant="ghost" label="New worktree" />
        </div>
        <button class="am-local-item">
          <Icon name="folder" size="small" class="am-local-icon" />
          <span class="am-local-text">
            <span class="am-local-label">LOCAL</span>
            <span class="am-local-branch">main</span>
          </span>
        </button>

        <div class="am-section-header am-orch-worktrees-header">
          <span class="am-section-label">Worktrees</span>
        </div>
        <Show
          when={running()}
          fallback={
            <button class="am-orch-worktree am-orch-worktree-active">
              <Icon name="organization" size="small" />
              <span class="am-orch-worktree-copy">
                <span>New orchestration</span>
                <small>{stage() === "configure" ? "Review configuration" : "Not started"}</small>
              </span>
            </button>
          }
        >
          <button class="am-orch-worktree am-orch-worktree-active">
            <Icon name="organization" size="small" />
            <span class="am-orch-worktree-copy">
              <span>Checkout reliability</span>
              <small>
                <StatusDot state={paused() ? "queued" : "active"} /> {paused() ? "Paused" : "3 working · 1 needs input"}
              </small>
            </span>
          </button>
        </Show>
        <button class="am-orch-worktree">
          <Icon name="branch" size="small" />
          <span class="am-orch-worktree-copy">
            <span>Settings sync</span>
            <small>feat/settings-sync · idle</small>
          </span>
        </button>

        <div class="am-orch-sidebar-footer">
          <Button size="small" variant="ghost" icon="plus">
            New worktree
          </Button>
        </div>
      </aside>

      <section class="am-detail">
        <div class="am-tab-bar">
          <div class="am-tab-leading">
            <SidebarToggleButton collapsed={false} onClick={() => undefined} />
          </div>
          <div class="am-tab-scroll-area">
            <div class="am-tab-list-wrap">
              <div class="am-tab-list" style={{ "--tab-count": running() ? "2" : "1" } as JSX.CSSProperties}>
                <div class="am-tab-sortable">
                  <div class="am-tab am-tab-active">
                    <span class="am-tab-icon">
                      <Icon name="organization" size="small" />
                    </span>
                    <span class="am-tab-label">{running() ? "Orchestrator" : "New orchestration"}</span>
                  </div>
                </div>
                <Show when={running()}>
                  <div class="am-tab-sortable">
                    <div class="am-tab">
                      <span class="am-tab-label">API candidate</span>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>
          <div class="am-tab-add-wrap">
            <div class="am-tab-add-separator" />
            <IconButton icon="plus" size="small" variant="ghost" label="New session" />
          </div>
          <div class="am-tab-actions">
            <Show when={running()}>
              <Button
                size="small"
                variant="ghost"
                icon={paused() ? "play" : "stop"}
                disabled={stopped()}
                onClick={() => setPaused((value) => !value)}
              >
                {paused() ? "Resume" : "Pause"}
              </Button>
              <Button size="small" variant="ghost" icon="stop" disabled={stopped()} onClick={() => setStopped(true)}>
                Stop
              </Button>
              <IconButton
                icon={open() ? "layout-right-full" : "layout-right"}
                size="small"
                variant="ghost"
                class={open() ? "am-tab-diff-btn-active" : ""}
                label="Toggle orchestration details"
                onClick={() => setOpen((value) => !value)}
              />
            </Show>
          </div>
        </div>

        <Show
          when={running()}
          fallback={
            <div class="am-detail-content am-orch-setup-host">
              <Show
                when={stage() === "start"}
                fallback={
                  <OrchestratorSetup
                    config={config()}
                    onChange={setConfig}
                    onBack={() => setStage("start")}
                    onStart={() => setStage("running")}
                  />
                }
              >
                <OrchestratorStart
                  goal={config().goal}
                  onGoal={(goal) => setConfig((value) => ({ ...value, goal }))}
                  onConfigure={() => setStage("configure")}
                  onStart={() => setStage("running")}
                />
              </Show>
            </div>
          }
        >
          <div class="am-detail-content am-detail-split">
            <div class="am-main-pane">
              <div class="am-orch-runbar">
                <span>
                  <StatusDot state={paused() || stopped() ? "queued" : "active"} /> {status()} · phase 3 of 5
                </span>
                <span>{paused() || stopped() ? "0" : config().concurrency} active</span>
                <span>$2.57 / ${config().budget.toFixed(2)}</span>
                <button
                  onClick={() => {
                    setView("controls")
                    setOpen(true)
                  }}
                >
                  {config().policy} <Icon name="settings-gear" size="small" />
                </button>
              </div>
              {props.children}
            </div>

            <Show when={open()}>
              <aside class="am-diff-resize am-orch-inspector" style={{ width: "320px" }}>
                <div class="am-diff-panel-wrapper">
                  <header class="am-diff-header am-orch-inspector-header">
                    <div class="am-orch-inspector-tabs" role="tablist" aria-label="Orchestration details">
                      <button classList={{ active: view() === "plan" }} onClick={() => setView("plan")}>
                        Plan
                      </button>
                      <button classList={{ active: view() === "controls" }} onClick={() => setView("controls")}>
                        Controls
                      </button>
                      <button classList={{ active: view() === "history" }} onClick={() => setView("history")}>
                        History
                      </button>
                    </div>
                    <IconButton
                      icon="close-small"
                      size="small"
                      variant="ghost"
                      label="Close"
                      onClick={() => setOpen(false)}
                    />
                  </header>

                  <Show
                    when={view() !== "history"}
                    fallback={
                      <div class="am-orch-history">
                        <For each={history}>
                          {(item) => (
                            <div class="am-orch-history-item">
                              <div class="am-orch-history-icon">
                                <Icon name={item.icon} size="small" />
                              </div>
                              <div>
                                <strong>{item.title}</strong>
                                <p>{item.detail}</p>
                                <small>{item.time}</small>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    }
                  >
                    <Show
                      when={view() === "plan"}
                      fallback={<OrchestratorControls config={config()} onChange={setConfig} />}
                    >
                      <div class="am-orch-inspector-body">
                        <section class="am-orch-summary">
                          <div>
                            <span>Goal</span>
                            <strong>{config().goal}</strong>
                          </div>
                          <div class="am-orch-progress">
                            <span style={{ width: "58%" }} />
                          </div>
                          <small>58% · 18m elapsed</small>
                        </section>

                        <section class="am-orch-decision">
                          <Icon name="warning" size="small" />
                          <div>
                            <strong>Contract decision needed</strong>
                            <p>The verifier reproduced a duplicate-intent race.</p>
                            <Button size="small" variant="primary">
                              Review
                            </Button>
                          </div>
                        </section>

                        <section class="am-orch-section">
                          <header>
                            <span>Plan</span>
                            <small>v3</small>
                          </header>
                          <ol class="am-orch-phases">
                            <For each={phases}>
                              {(phase, index) => (
                                <li data-state={phase.state}>
                                  <span class="am-orch-phase-index">
                                    <Show when={phase.state === "complete"} fallback={index() + 1}>
                                      <Icon name="check-small" size="small" />
                                    </Show>
                                  </span>
                                  <div>
                                    <strong>{phase.label}</strong>
                                    <small>{phase.meta}</small>
                                  </div>
                                </li>
                              )}
                            </For>
                          </ol>
                        </section>

                        <section class="am-orch-section">
                          <header>
                            <span>Workers</span>
                            <small>4</small>
                          </header>
                          <div class="am-orch-workers">
                            <For each={workers}>
                              {(worker) => (
                                <button>
                                  <StatusDot state={worker.state} />
                                  <span>
                                    <strong>{worker.name}</strong>
                                    <small>{worker.detail}</small>
                                  </span>
                                  <em>{worker.model}</em>
                                </button>
                              )}
                            </For>
                          </div>
                        </section>
                      </div>
                    </Show>
                  </Show>
                </div>
              </aside>
            </Show>
          </div>
        </Show>
      </section>
    </div>
  )
}
