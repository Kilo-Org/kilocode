/** @jsxImportSource solid-js */
/**
 * Interactive Ultra Mode prototypes inside the real extension sidebar shell.
 * The story catalog is intentionally constrained so product exploration stays
 * focused instead of exposing the full production model list.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
  type JSX,
  type ParentComponent,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Switch as Toggle } from "@kilocode/kilo-ui/switch"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { VscodeUserMessage } from "../components/chat/VscodeUserMessage"
import { WelcomeEmptyState } from "../components/chat/WelcomeEmptyState"
import { SessionContext } from "../context/session"
import { ServerContext } from "../context/server"
import { WorktreeModeProvider } from "../context/worktree-mode"
import type { EnrichedModel } from "../context/provider"
import { useVSCode } from "../context/vscode"
import type { Message, ModelSelection, Part } from "../types/messages"
import type { SlashCommandEntry } from "../hooks/useSlashCommand"
import { OrchestratorPrototype } from "../../agent-manager/OrchestratorPrototype"
import "../../agent-manager/agent-manager.css"
import "./ultra-mode.stories.css"

const SESSION_ID = "ultra-workflow-story"
const ULTRA_EVENT = "story:ultra-effort"
const variants = ["none", "low", "medium", "high", "xhigh", "max", "ultra"]
const agents = [
  { name: "code", displayName: "Code", description: "Write, edit, and review code", mode: "primary" as const },
  {
    name: "ask",
    displayName: "Ask",
    description: "Explore and explain without making changes",
    mode: "primary" as const,
  },
  {
    name: "architect",
    displayName: "Architect",
    description: "Plan and design before implementation",
    mode: "primary" as const,
  },
]
const models: EnrichedModel[] = [
  {
    id: "auto",
    name: "Auto",
    providerID: "kilo",
    providerName: "Kilo",
    recommendedIndex: 0,
    autoRouting: { models: ["anthropic/claude-opus-5", "openai/gpt-5.6"] },
  },
  {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    providerID: "kilo",
    providerName: "Kilo",
    recommendedIndex: 1,
  },
  {
    id: "openai/gpt-5.6",
    name: "GPT-5.6",
    providerID: "kilo",
    providerName: "Kilo",
    recommendedIndex: 2,
  },
]

const CompactSelector: ParentComponent = (props) => {
  const vscode = useVSCode()
  onMount(() => vscode.setModelSelectorExpanded(false))
  return props.children
}

const PrototypeProviders: ParentComponent<{
  modelID?: string
  effort?: string
  git?: boolean
  onSend?: (text: string) => void
}> = (props) => {
  const base = mockSessionValue({ id: SESSION_ID, status: "idle" })
  const [model, setModel] = createSignal<ModelSelection>({
    providerID: "kilo",
    modelID: props.modelID ?? "openai/gpt-5.6",
  })
  const [effort, setEffort] = createSignal(props.effort ?? "medium")
  const [agent, setAgent] = createSignal("code")
  onMount(() => {
    const select = (event: Event) => setEffort((event as CustomEvent<string>).detail ?? "ultra")
    window.addEventListener(ULTRA_EVENT, select)
    onCleanup(() => window.removeEventListener(ULTRA_EVENT, select))
  })
  const session = {
    ...base,
    agents: () => agents,
    allAgents: () => agents,
    selectedAgent: () => agent(),
    getSessionAgent: () => agent(),
    selectAgent: (name: string) => setAgent(name),
    sendMessage: (text: string) => props.onSend?.(text),
    selected: () => model(),
    modelForAgent: () => model(),
    configModelForAgent: () => model(),
    selectModel: (providerID: string, modelID: string) => setModel({ providerID, modelID }),
    variantList: () => variants,
    currentVariant: () => effort(),
    variantForAgent: () => effort(),
    selectVariant: (value: string) => setEffort(value),
  }

  return (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding models={models}>
      <ServerContext.Provider value={props.git === false ? { ...server, gitInstalled: () => false } : server}>
        <CompactSelector>
          <SessionContext.Provider value={session as any}>
            <div class="ultra-prototype-root" classList={{ "ultra-effort-active": effort() === "ultra" }}>
              {props.children}
            </div>
          </SessionContext.Provider>
        </CompactSelector>
      </ServerContext.Provider>
    </StoryProviders>
  )
}

const Workbench: ParentComponent<{ title?: string; inspector?: JSX.Element }> = (props) => (
  <div class="ultra-workbench">
    <aside class="ultra-workbench-sidebar">{props.children}</aside>
    <main class="ultra-workbench-editor">
      <div class="ultra-workbench-editor-tabs">
        <div class="is-active">
          <Icon name="code" size="small" />
          <span>{props.title ?? "Welcome"}</span>
        </div>
      </div>
      <div class="ultra-workbench-editor-stage">{props.inspector}</div>
    </main>
  </div>
)

type Stage = "idle" | "planning" | "approval" | "running" | "paused" | "complete"

const phases = [
  { name: "Discover the surface", detail: "Map routes, auth helpers, and shared middleware", agents: 2, end: 20 },
  { name: "Audit authentication", detail: "Check each route and cross-review findings", agents: 4, end: 50 },
  { name: "Implement isolated fixes", detail: "Apply independent changes without collisions", agents: 3, end: 78 },
  { name: "Verify and synthesize", detail: "Run checks and produce one trusted report", agents: 2, end: 100 },
]

/** Planning scale guideline: how many agents the planner should aim for. */
const scales = [
  { label: "Focused", hint: "up to 5 agents", cap: 5 },
  { label: "Balanced", hint: "up to 15 agents", cap: 15 },
  { label: "Broad", hint: "up to 50 agents", cap: 50 },
  { label: "Unrestricted", hint: "sized to the task", cap: Number.POSITIVE_INFINITY },
]
const permissions = [
  { value: "once", label: "Ask first" },
  { value: "trusted", label: "Trusted" },
  { value: "review", label: "Read-only" },
]
const phaseModels = [
  { value: "auto", label: "Auto" },
  { value: "gpt", label: "GPT-5.6" },
  { value: "opus", label: "Opus 5" },
]
const counts = Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: `${index + 1}` }))
const modelIds: Record<string, string> = {
  auto: "auto",
  gpt: "openai/gpt-5.6",
  opus: "anthropic/claude-opus-5",
}

type PhaseConfig = { name: string; agents: number; model: string; isolated: boolean; verify: boolean }

/** Each phase contributes one block to the generated orchestration script. */
const snippets: ((phase: PhaseConfig) => string)[] = [
  (phase) => `const surface = await agent("List every route handler under src/routes/.", {
  model: "${modelIds[phase.model]}",
  schema: {
    type: "object",
    properties: { files: { type: "array", items: { type: "string" } } },
  },
})`,
  (phase) => `const findings = await pipeline(surface.files, (file) =>
  agent(\`Audit \${file} for missing authentication checks.\`, {
    model: "${modelIds[phase.model]}",
    concurrency: ${phase.agents},
    label: file,
  }),
)`,
  (phase) => `const fixes = await pipeline(findings.filter(Boolean), (finding) =>
  agent(\`Fix \${finding.file} without changing any public contract.\`, {
    model: "${modelIds[phase.model]}",
    concurrency: ${phase.agents},${phase.isolated ? "\n    isolate: true," : ""}
  }),
)`,
  (phase) => `const verified = await pipeline(fixes.filter(Boolean), (fix) =>
  agent(\`Independently verify \${fix.file} and reject unconfirmed claims.\`, {
    model: "${modelIds[phase.model]}",
    concurrency: ${phase.agents},
  }),
)`,
]

const Row: Component<{ label: string; hint: string; children: JSX.Element }> = (props) => (
  <div class="ultra-row">
    <Tooltip value={props.hint} placement="top">
      <span class="ultra-row-label">{props.label}</span>
    </Tooltip>
    <div class="ultra-row-control">{props.children}</div>
  </div>
)

const UltraWorkflowFlow: Component = () => {
  const [stage, setStage] = createSignal<Stage>("idle")
  const [progress, setProgress] = createSignal(0)
  const [prompt, setPrompt] = createSignal("")
  const [pane, setPane] = createSignal<"none" | "script" | "inspector">("none")
  const [saved, setSaved] = createSignal(false)
  const [ultra, setUltra] = createSignal(true)
  const [scale, setScale] = createSignal(1)
  const [permission, setPermission] = createSignal("once")
  const [strict, setStrict] = createSignal(true)
  const [cfg, setCfg] = createStore(
    phases.map((phase, index) => ({
      ...phase,
      model: index < 2 ? "gpt" : index === 2 ? "opus" : "auto",
      isolated: index === 2,
      verify: index !== 0,
    })),
  )

  createEffect(() => {
    if (stage() === "planning") {
      const timer = window.setTimeout(() => setStage("approval"), 900)
      onCleanup(() => window.clearTimeout(timer))
      return
    }
    if (stage() !== "running") return
    const timer = window.setInterval(() => {
      setProgress((value) => {
        const next = Math.min(100, value + 4)
        if (next === 100) setStage("complete")
        return next
      })
    }, 450)
    onCleanup(() => window.clearInterval(timer))
  })

  const start = (text: string) => {
    if (!text.trim()) return
    setPrompt(text)
    setProgress(0)
    setSaved(false)
    setPane("none")
    setStage("planning")
  }
  const run = () => {
    setProgress(4)
    setPane("inspector")
    setStage("running")
  }
  const reset = () => {
    setProgress(0)
    setPane("none")
    setStage("idle")
  }
  const state = (index: number) => {
    if (stage() === "approval" || stage() === "planning") return "planned"
    const start = index === 0 ? 0 : cfg[index - 1].end
    if (progress() >= cfg[index].end) return "complete"
    if (progress() >= start) return stage() === "paused" ? "paused" : "running"
    return "waiting"
  }
  const current = () => cfg.findIndex((phase) => progress() < phase.end)
  const total = () => cfg.reduce((sum, phase) => sum + phase.agents, 0)
  const isolated = () => cfg.filter((phase) => phase.isolated).length
  const reviewed = () => cfg.filter((phase) => phase.verify).length
  const guide = () => scales[scale()]
  const over = () => total() > guide().cap
  const done = () => Math.min(total(), Math.floor((progress() / 100) * total()))
  const message = (): Message => ({
    id: "ultra-workflow-user",
    sessionID: SESSION_ID,
    role: "user",
    createdAt: new Date(0).toISOString(),
    time: { created: 0 },
  })
  const parts = (): Part[] => [
    {
      id: "ultra-workflow-user-text",
      sessionID: SESSION_ID,
      messageID: "ultra-workflow-user",
      type: "text",
      text: prompt(),
    },
  ]
  const command: SlashCommandEntry[] = [
    {
      name: "ultra",
      description: "Use Ultra thinking effort",
      hints: ["reasoning", "thinking"],
      action: () => {
        setUltra(true)
        window.dispatchEvent(new CustomEvent(ULTRA_EVENT))
      },
    },
  ]

  const addon = () => (
    <Show when={stage() === "running" || stage() === "paused"}>
      <Card class="ultra-dock">
        <div class="ultra-dock-head">
          <span class="ultra-live" classList={{ paused: stage() === "paused" }} />
          <span class="ultra-dock-title">Ultra</span>
          <span class="ultra-dock-status">
            {stage() === "paused" ? "Paused" : `Phase ${Math.max(1, current() + 1)} of ${cfg.length}`} · {done()}/
            {total()} agents
          </span>
          <small>{progress()}%</small>
        </div>
        <div class="ultra-track">
          <span style={{ width: `${progress()}%` }} />
        </div>
        <footer class="ultra-dock-footer">
          <Button variant="secondary" size="small" onClick={() => setPane("inspector")}>
            Open
          </Button>
          <Button variant="ghost" size="small" onClick={() => setStage(stage() === "paused" ? "running" : "paused")}>
            {stage() === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button variant="ghost" size="small" onClick={() => setStage("approval")}>
            Stop
          </Button>
        </footer>
      </Card>
    </Show>
  )

  const conversation = () => (
    <Show when={stage() !== "idle"} fallback={<WelcomeEmptyState />}>
      <div class="ultra-flow-conversation">
        <VscodeUserMessage message={message()} parts={parts()} />
        <div class="ultra-flow-assistant-message">
          <Switch>
            <Match when={stage() === "planning"}>
              <Card class="ultra-card ultra-planning">
                <Spinner />
                <div>
                  <strong>Planning an Ultra workflow</strong>
                  <small>Sizing the fan-out, isolation, and verification</small>
                </div>
              </Card>
            </Match>

            <Match when={stage() === "approval"}>
              <div class="ultra-flow-message">
                <div class="ultra-intro">
                  <p>
                    This needs ~{total()} agents across {cfg.length} phases, so I planned it as a workflow instead of
                    working through it turn by turn.
                  </p>
                  <p>
                    Nothing runs until you approve.{" "}
                    <Show
                      when={isolated() > 0}
                      fallback="Every phase works directly in your worktree, so I kept the editing steps sequential."
                    >
                      Edits run in {isolated() === 1 ? "an isolated worktree" : `${isolated()} isolated worktrees`}, so
                      parallel workers cannot collide.
                    </Show>
                  </p>
                  <Show when={over()}>
                    <p class="ultra-note">
                      <Icon name="warning" size="small" />
                      <span>
                        This plan is above your {guide().label.toLowerCase()} scale ({guide().hint}) and will use
                        noticeably more tokens. Lower the phase agent counts to bring it back in range.
                      </span>
                    </p>
                  </Show>
                </div>
                <Card class="ultra-card">
                  <header class="ultra-card-header">
                    <span class="ultra-mark">
                      <Icon name="brain" size="small" />
                    </span>
                    <div>
                      <small>Ultra workflow</small>
                      <strong>Audit and repair API authentication</strong>
                    </div>
                  </header>

                  <div class="ultra-rows">
                    <div class="ultra-row ultra-row-stacked">
                      <div class="ultra-row-head">
                        <Tooltip value="How many agents the planner should aim for" placement="top">
                          <span class="ultra-row-label">Planning scale</span>
                        </Tooltip>
                        <small>
                          {guide().label} · {guide().hint}
                        </small>
                      </div>
                      <input
                        class="ultra-slider"
                        type="range"
                        min="0"
                        max={scales.length - 1}
                        step="1"
                        value={scale()}
                        aria-label="Planning scale"
                        style={{ "--fill": `${(scale() / (scales.length - 1)) * 100}%` }}
                        onInput={(event) => setScale(Number(event.currentTarget.value))}
                      />
                      <div class="ultra-slider-ticks" aria-hidden="true">
                        <For each={scales}>{() => <span />}</For>
                      </div>
                    </div>
                    <Row label="Approval" hint="Whether this workflow may start without asking again">
                      <Select
                        options={permissions}
                        current={permissions.find((item) => item.value === permission())}
                        value={(item) => item.value}
                        label={(item) => item.label}
                        onSelect={(item) => item && setPermission(item.value)}
                        variant="secondary"
                        size="small"
                      />
                    </Row>
                    <div class="ultra-row ultra-row-stacked">
                      <div class="ultra-row-head">
                        <span class="ultra-row-label">Strict verification</span>
                        <Toggle checked={strict()} onChange={setStrict} hideLabel>
                          Strict verification
                        </Toggle>
                      </div>
                      <p class="ultra-row-note">
                        <Show
                          when={strict() && reviewed() > 0}
                          fallback="Findings are reported without a second agent confirming them."
                        >
                          Findings only reach the report if independent verifier agents confirm them.
                        </Show>
                      </p>
                    </div>
                  </div>

                  <div class="ultra-section">
                    <span>Phases</span>
                    <small>
                      {cfg.length} steps · {total()} agents
                    </small>
                  </div>

                  <div class="ultra-phases">
                    <For each={cfg}>
                      {(phase, index) => (
                        <Collapsible class="ultra-phase" variant="ghost">
                          <Collapsible.Trigger>
                            <span class="ultra-phase-index">{index() + 1}</span>
                            <span class="ultra-phase-name">{phase.name}</span>
                            <small class="ultra-phase-meta">
                              <Show when={phase.isolated}>
                                <Icon name="branch" size="small" />
                              </Show>
                              <Show when={phase.verify}>
                                <Icon name="shield" size="small" />
                              </Show>
                              <span>
                                {phase.agents}× {phaseModels.find((item) => item.value === phase.model)?.label}
                              </span>
                            </small>
                            <Collapsible.Arrow />
                          </Collapsible.Trigger>
                          <Collapsible.Content>
                            <div class="ultra-phase-body">
                              <p>{phase.detail}</p>
                              <div class="ultra-rows">
                                <Row label="Model" hint="Model used by every worker in this phase">
                                  <Select
                                    options={phaseModels}
                                    current={phaseModels.find((item) => item.value === phase.model)}
                                    value={(item) => item.value}
                                    label={(item) => item.label}
                                    onSelect={(item) => item && setCfg(index(), "model", item.value)}
                                    variant="secondary"
                                    size="small"
                                  />
                                </Row>
                                <Row label="Agents" hint="Maximum workers running at the same time">
                                  <Select
                                    options={counts}
                                    current={counts.find((item) => item.value === phase.agents)}
                                    value={(item) => `${item.value}`}
                                    label={(item) => item.label}
                                    onSelect={(item) => item && setCfg(index(), "agents", item.value)}
                                    variant="secondary"
                                    size="small"
                                  />
                                </Row>
                                <Row label="Isolated edits" hint="Give each editing worker its own worktree">
                                  <Toggle
                                    checked={phase.isolated}
                                    onChange={(value) => setCfg(index(), "isolated", value)}
                                    hideLabel
                                  >
                                    Isolated edits
                                  </Toggle>
                                </Row>
                                <Row label="Independent review" hint="Cross-check this phase with a separate verifier">
                                  <Toggle
                                    checked={phase.verify}
                                    onChange={(value) => setCfg(index(), "verify", value)}
                                    hideLabel
                                  >
                                    Independent review
                                  </Toggle>
                                </Row>
                              </div>
                            </div>
                          </Collapsible.Content>
                        </Collapsible>
                      )}
                    </For>
                  </div>

                  <footer class="ultra-card-footer">
                    <Button variant="primary" size="small" onClick={run}>
                      Run workflow
                    </Button>
                    <Button variant="secondary" size="small" onClick={reset}>
                      Edit prompt
                    </Button>
                    <Button variant="ghost" size="small" onClick={() => setPane("script")}>
                      View script
                    </Button>
                  </footer>
                </Card>
              </div>
            </Match>

            <Match when={stage() === "running" || stage() === "paused"}>
              <div class="ultra-flow-message">
                <div class="ultra-intro">
                  <p>
                    Running {total()} agents in the background. You can keep chatting while it works, and I will post a
                    single report instead of a turn-by-turn transcript.
                  </p>
                  <p>Stopping keeps whatever finished, so pausing mid-run is safe.</p>
                </div>
              </div>
            </Match>

            <Match when={stage() === "complete"}>
              <div class="ultra-flow-message">
                <div class="ultra-intro">
                  <p>
                    All {cfg.length} phases finished. {total()} agents ran, and{" "}
                    <Show when={strict() && reviewed() > 0} fallback="findings are reported without cross-checking.">
                      only findings a second agent could confirm made it into the report.
                    </Show>
                  </p>
                </div>
                <Card class="ultra-card ultra-complete">
                  <header class="ultra-card-header">
                    <span class="ultra-mark" data-tone="done">
                      <Icon name="check-small" size="small" />
                    </span>
                    <div>
                      <small>Ultra completed</small>
                      <strong>Authentication audit finished</strong>
                    </div>
                  </header>
                  <div class="ultra-results">
                    <div>
                      <Icon name="check-small" size="small" />
                      <span>5 issues fixed and verified</span>
                    </div>
                    <div data-tone="attention">
                      <Icon name="warning" size="small" />
                      <span>1 public API decision needs you</span>
                    </div>
                  </div>
                  <footer class="ultra-card-footer">
                    <Button variant="primary" size="small" onClick={() => setPane("inspector")}>
                      Review results
                    </Button>
                    <Button variant="secondary" size="small" onClick={() => setSaved(true)}>
                      {saved() ? "Saved" : "Save workflow"}
                    </Button>
                    <Tooltip value="Run again" placement="top">
                      <IconButton
                        icon="reset"
                        size="small"
                        variant="ghost"
                        aria-label="Run again"
                        onClick={() => setStage("approval")}
                      />
                    </Tooltip>
                  </footer>
                </Card>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  )

  const chip = () => (
    <Show when={ultra()}>
      <div class="ultra-prompt-chip-row">
        <Button
          class="ultra-prompt-chip"
          variant="secondary"
          size="small"
          aria-label="Remove Ultra effort"
          onClick={() => {
            setUltra(false)
            window.dispatchEvent(new CustomEvent(ULTRA_EVENT, { detail: "medium" }))
          }}
        >
          <Icon name="brain" size="small" />
          <span>Ultra</span>
          <Icon name="close-small" size="small" />
        </Button>
      </div>
    </Show>
  )

  const script = () =>
    [
      "export const meta = {",
      '  name: "audit-api-auth",',
      '  description: "Audit and repair API authentication",',
      `  scale: "${guide().label.toLowerCase()}",`,
      "}",
      "",
      ...cfg.flatMap((phase, index) => [
        `// Phase ${index + 1} — ${phase.name} (${phase.agents} agents${phase.isolated ? " · isolated" : ""}${
          phase.verify ? " · reviewed" : ""
        })`,
        snippets[index](phase),
        "",
      ]),
      strict() ? "return report(verified.filter((item) => item.confirmed))" : "return report(verified.filter(Boolean))",
    ].join("\n")

  const scriptPane = () => (
    <Show when={pane() === "script"}>
      <section class="ultra-script">
        <header>
          <div>
            <small>Generated workflow</small>
            <h2>audit-api-auth.js</h2>
          </div>
          <Button variant="ghost" size="small" onClick={() => setPane("none")}>
            Close
          </Button>
        </header>
        <p>
          I wrote this orchestration from your prompt. It runs in an isolated runtime, so intermediate results stay in
          script variables instead of the conversation. Editing the card above rewrites it.
        </p>
        <pre class="ultra-script-code">{script()}</pre>
        <footer>
          <Button variant="primary" size="small" onClick={run}>
            Run workflow
          </Button>
          <Button variant="secondary" size="small" onClick={reset}>
            Edit prompt
          </Button>
        </footer>
      </section>
    </Show>
  )

  const inspector = () => (
    <Show when={pane() === "inspector"}>
      <section class="ultra-flow-inspector">
        <header>
          <div>
            <small>ULTRA WORKFLOW</small>
            <h2>Authentication audit</h2>
          </div>
          <span data-state={stage()}>{stage()}</span>
        </header>
        <div class="ultra-flow-inspector-meta">
          <span>{total()} agents</span>
          <span>GPT-5.6</span>
          <span>Isolated edits</span>
          <span>{progress()}% complete</span>
        </div>
        <div class="ultra-flow-inspector-track">
          <span style={{ width: `${progress()}%` }} />
        </div>
        <div class="ultra-flow-inspector-phases">
          <For each={cfg}>
            {(phase, index) => (
              <article data-state={state(index())}>
                <div class="ultra-flow-phase-status">
                  <Switch fallback={<span />}>
                    <Match when={state(index()) === "complete"}>
                      <Icon name="check-small" size="small" />
                    </Match>
                    <Match when={state(index()) === "running"}>
                      <Spinner />
                    </Match>
                    <Match when={state(index()) === "paused"}>
                      <Icon name="dash" size="small" />
                    </Match>
                  </Switch>
                </div>
                <div>
                  <small>PHASE {index() + 1}</small>
                  <h3>{phase.name}</h3>
                  <p>{phase.detail}</p>
                  <span>{phase.agents} agents</span>
                </div>
                <strong>{state(index())}</strong>
              </article>
            )}
          </For>
        </div>
        <footer>
          <Show when={stage() === "running" || stage() === "paused"}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setStage(stage() === "paused" ? "running" : "paused")}
            >
              {stage() === "paused" ? "Resume workflow" : "Pause workflow"}
            </Button>
            <Button variant="ghost" size="small" onClick={() => setStage("approval")}>
              Stop
            </Button>
          </Show>
          <Button variant="ghost" size="small" onClick={() => setPane("none")}>
            Close inspector
          </Button>
        </footer>
      </section>
    </Show>
  )

  return (
    <PrototypeProviders effort="ultra" git={false} onSend={start}>
      <Workbench
        title={pane() === "script" ? "audit-api-auth.js" : pane() === "inspector" ? "Ultra Workflow" : "Welcome"}
        inspector={
          <>
            {scriptPane()}
            {inspector()}
          </>
        }
      >
        <ChatView emptyState={conversation} promptAddon={addon} promptChip={chip} promptCommands={command} />
      </Workbench>
    </PrototypeProviders>
  )
}

const meta: Meta = {
  title: "UltraMode",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

export const WorkflowInteractive: Story = {
  name: "Workflow - interactive flow",
  render: () => <UltraWorkflowFlow />,
}

const time = 1_718_000_000_000
const orchestratorSessionID = "story-orchestrator-session"
const orchestratorUserID = "story-orchestrator-user"
const orchestratorAssistantID = "story-orchestrator-assistant"
const orchestratorMessages = [
  {
    id: orchestratorUserID,
    sessionID: orchestratorSessionID,
    role: "user",
    createdAt: new Date(time).toISOString(),
    time: { created: time },
  },
  {
    id: orchestratorAssistantID,
    sessionID: orchestratorSessionID,
    role: "assistant",
    parentID: orchestratorUserID,
    createdAt: new Date(time + 1000).toISOString(),
    time: { created: time + 1000, completed: time + 5000 },
    modelID: "anthropic/claude-opus-5",
    providerID: "kilo",
    mode: "default",
    agent: "orchestrator",
    path: { cwd: "/project", root: "/project" },
  },
]
const orchestratorParts = {
  [orchestratorUserID]: [
    {
      id: "story-orchestrator-user-text",
      sessionID: orchestratorSessionID,
      messageID: orchestratorUserID,
      type: "text",
      text: "Make checkout retries safe without changing payment providers. Use cheaper workers where the work is bounded, but stop before changing a public contract.",
    },
  ],
  [orchestratorAssistantID]: [
    {
      id: "story-orchestrator-assistant-text",
      sessionID: orchestratorSessionID,
      messageID: orchestratorAssistantID,
      type: "text",
      text: "I split this into failure-mode research, two isolated implementation candidates, and an independent verification pass. The bounded implementation work is running on K3 while I keep the lead context here.\n\nThe verifier found one issue that changes the plan: reliable retries need an idempotency key or a reconciliation path. I paused the payment matrix because this crosses your contract-change guardrail. My recommendation is to add an optional idempotency key, then verify the selected candidate against the full retry matrix.",
    },
  ],
}
const orchestratorData = {
  ...defaultMockData,
  message: { [orchestratorSessionID]: orchestratorMessages },
  part: orchestratorParts,
}
const server = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => null,
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => undefined,
  goToLogin: () => undefined,
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

function renderOrchestrator(stage: "running") {
  const session = {
    ...mockSessionValue({ id: orchestratorSessionID, status: "idle", closeReason: "completed" }),
    currentSession: () => ({
      id: orchestratorSessionID,
      title: "Checkout reliability",
      createdAt: new Date(time).toISOString(),
      updatedAt: new Date(time + 5000).toISOString(),
    }),
    messages: () => orchestratorMessages,
    visibleMessages: () => orchestratorMessages,
    userMessages: () => orchestratorMessages.filter((message) => message.role === "user"),
    getParts: (id: string) => orchestratorParts[id as keyof typeof orchestratorParts] ?? [],
    worktreeStats: () => ({ files: 11, additions: 382, deletions: 96 }),
    selected: () => ({ providerID: "kilo", modelID: "anthropic/claude-opus-5" }),
    modelForAgent: () => ({ providerID: "kilo", modelID: "anthropic/claude-opus-5" }),
    configModelForAgent: () => ({ providerID: "kilo", modelID: "anthropic/claude-opus-5" }),
    agents: () => [{ name: "orchestrator", description: "Coordinates parallel workers", mode: "primary" as const }],
    allAgents: () => [{ name: "orchestrator", description: "Coordinates parallel workers", mode: "primary" as const }],
    selectedAgent: () => "orchestrator",
    getSessionAgent: () => "orchestrator",
  }
  return (
    <StoryProviders data={orchestratorData} sessionID={orchestratorSessionID} status="idle" noPadding>
      <ServerContext.Provider value={server}>
        <SessionContext.Provider value={session as any}>
          <WorktreeModeProvider>
            <OrchestratorPrototype initialStage={stage}>
              <div class="am-chat-wrapper">
                <ChatView onForkSession={() => undefined} />
              </div>
            </OrchestratorPrototype>
          </WorktreeModeProvider>
        </SessionContext.Provider>
      </ServerContext.Provider>
    </StoryProviders>
  )
}

export const WorkflowExecutionMonitor: Story = {
  name: "Workflow - execution monitor",
  render: () => renderOrchestrator("running"),
}
