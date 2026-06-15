import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { ConfigRow, SectionTitle } from "@kilocode/kilo-web-ui/console"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { SearchField } from "../../components/SearchField"
import { useConfig } from "../../context/config"
import { settings } from "../../shared/navigation"
import { toolCapabilities, toolName } from "../../shared/utils"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { ActionSelect, label as actionLabel, tone as actionTone } from "./PermissionsRoute"
import { agentEditable, agentTitle, snippets, useAgentBuilder, type AgentEntry, type AgentItem } from "./state/agents"
import type { PermissionAction } from "./state/permissions"

type Row = { item: AgentItem; entry?: AgentEntry; rank: number }

const colors = ["#0e639c", "#89d185", "#cca700", "#f14c4c", "#3794ff", "#c586c0", "#9cdcfe"]
const modes = [
  { value: "primary", label: "Primary" },
  { value: "subagent", label: "Subagent" },
  { value: "all", label: "Both" },
] satisfies SelectOption<"primary" | "subagent" | "all">[]

function desc(item: AgentItem) {
  return item.description ?? "No description available."
}

function label(rank: number) {
  if (rank === 0) return "Project Agents"
  return "Global Agents"
}

function useAgentLinks() {
  const loc = useLocation()
  const nav = useNavigate()
  const href = (id?: string) => {
    const suffix = id ? `/${encodeURIComponent(id)}` : ""
    return `${settings(loc.pathname)}/agents${suffix}${loc.search}`
  }
  return { href, nav }
}

function countTools(input: string[]) {
  if (input.length === 1) return "1 tool"
  return `${input.length} tools`
}

function FieldCard(props: { label: string; description?: string; actions?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="ui-field agent-builder-field">
      <div class="agent-builder-field-head">
        <div>
          <span>{props.label}</span>
          <Show when={props.description}>{(description) => <small>{description()}</small>}</Show>
        </div>
        <Show when={props.actions}>
          <div class="agent-builder-field-actions">{props.actions}</div>
        </Show>
      </div>
      <div class="agent-builder-control">{props.children}</div>
    </div>
  )
}

function AgentRuleMeta(props: { action: PermissionAction }) {
  return (
    <div class="permission-row-meta">
      <Tag tone={actionTone(props.action)}>{actionLabel(props.action)}</Tag>
    </div>
  )
}

export function AgentsRoute() {
  const links = useAgentLinks()
  const ctx = useConfig()
  const [search, setSearch] = createSignal("")
  const snap = () => ctx.data()
  const rows = createMemo(() => {
    const data = snap()
    if (!data) return []
    const scope = ctx.query()?.scope ?? "global"
    const entries = new Map((data.overlay.collections.agent ?? []).map((entry) => [entry.key, entry]))
    const local = new Set(
      (data.overlay.collections.agent ?? []).filter((entry) => entry.source === "project").map((entry) => entry.key),
    )
    return data.agents
      .filter((item) => {
        const entry = entries.get(item.name)
        if (scope === "global") return !entry?.local
        return local.has(item.name) || !entry?.local
      })
      .map((item) => ({ item, entry: entries.get(item.name), rank: local.has(item.name) ? 0 : 1 }))
      .sort((a, b) => a.rank - b.rank || agentTitle(a.item).localeCompare(agentTitle(b.item)))
  })
  const visible = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return rows()
    return rows().filter((row) =>
      `${agentTitle(row.item)} ${row.item.name} ${desc(row.item)}`.toLowerCase().includes(q),
    )
  })
  const groups = createMemo(() =>
    [0, 1].map((rank) => visible().filter((row) => row.rank === rank)).filter((row) => row.length),
  )
  const empty = createMemo(() => {
    if (!rows().length) return "No agents loaded."
    return "No agents match this filter."
  })

  return (
    <Show when={snap()}>
      {(_data) => (
        <ConfigPage
          title={
            <span class="config-title-count">
              Agents
              <CountTag>{rows().length}</CountTag>
            </span>
          }
          description="Agents are reusable model, prompt, and tool configurations. Primary agents drive sessions; subagents are delegated to."
          actions={
            <Button icon="plus" variant="primary" onClick={() => links.nav(links.href("new"))}>
              New agent
            </Button>
          }
        >
          <SearchField
            label="Filter agents"
            value={search()}
            placeholder="Filter by name or ID..."
            onValue={setSearch}
          />

          <div class="agents">
            <Show when={groups().length} fallback={<p class="empty">{empty()}</p>}>
              <For each={groups()}>
                {(group) => (
                  <section class="agent-section">
                    <Show when={ctx.query()?.scope === "project"}>
                      <SectionTitle>{label(group[0]?.rank ?? 1)}</SectionTitle>
                    </Show>
                    <For each={group}>
                      {(row) => (
                        <div classList={{ inherited: row.entry?.inherited }}>
                          <ConfigRow
                            leading={<span class="agent-mode-dot" data-mode={row.item.mode} aria-hidden="true" />}
                            title={agentTitle(row.item)}
                            subtitle={
                              <span class="agent-subtitle">
                                <span class="agent-id">{row.item.name}</span>
                                <span class="agent-description">{desc(row.item)}</span>
                              </span>
                            }
                            status={
                              <div class="tags agent-tags">
                                <Tag tone={row.item.mode === "primary" ? "brand" : "neutral"}>{row.item.mode}</Tag>
                                <Tag>{row.item.native ? "Native" : "Custom"}</Tag>
                                <Show when={row.item.hidden}>
                                  <Tag>Hidden</Tag>
                                </Show>
                                <Show when={row.item.deprecated}>
                                  <Tag>Deprecated</Tag>
                                </Show>
                                <Show when={row.entry}>
                                  {(entry) => (
                                    <SourceBadge
                                      source={entry().source}
                                      inherited={entry().inherited}
                                      overridden={entry().overridden}
                                    />
                                  )}
                                </Show>
                              </div>
                            }
                            actions={
                              <IconButton
                                icon={agentEditable(row.item, row.entry) ? "edit" : "eye"}
                                variant="ghost"
                                aria-label={`${agentEditable(row.item, row.entry) ? "Edit" : "Inspect"} ${agentTitle(row.item)}`}
                                onClick={() => links.nav(links.href(row.item.name))}
                              />
                            }
                          />
                        </div>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </Show>
          </div>
        </ConfigPage>
      )}
    </Show>
  )
}

export function AgentBuilderRoute() {
  const links = useAgentLinks()
  const params = useParams()
  const agent = () => (params.agentID === "new" ? undefined : params.agentID)
  const state = useAgentBuilder(agent)
  const title = createMemo(() => {
    if (!agent()) return "Agent Builder"
    if (state.locked()) return "Inspect Agent"
    return "Edit Agent"
  })

  return (
    <Show when={state.snap()}>
      {(_data) => (
        <ConfigPage
          title={title()}
          description="Build a reusable agent by combining a prompt, model, mode, and tool permissions."
          actions={
            <>
              <Button
                variant="secondary"
                disabled={Boolean(state.ctx.saving()) || !state.ready()}
                onClick={state.openMarkdown}
              >
                Markdown
              </Button>
              <Show when={!state.locked()}>
                <Button variant="primary" disabled={Boolean(state.ctx.saving()) || !state.ready()} onClick={state.save}>
                  Save
                </Button>
              </Show>
              <IconButton
                icon="close"
                variant="secondary"
                aria-label="Close agent builder"
                onClick={() => links.nav(links.href())}
              />
            </>
          }
        >
          <div class="builder agent-builder">
            <section class="builder-form agent-builder-stack">
              <Card class="ui-card agent-builder-card" padding={0}>
                <header class="ui-card-header">
                  <div>
                    <h2>Identity</h2>
                    <p>Name, mode, and display metadata for this agent.</p>
                  </div>
                </header>
                <div class="ui-form agent-builder-form">
                  <FieldCard label="Agent id" description="Used in @ mentions, commands, and agent files.">
                    <input
                      class="mono"
                      value={state.id()}
                      placeholder="reviewer"
                      readOnly={state.locked()}
                      spellcheck={false}
                      onInput={(event) => state.setId(event.currentTarget.value)}
                    />
                  </FieldCard>
                  <FieldCard label="Description" description="Shown when choosing or delegating to the agent.">
                    <input
                      value={state.desc()}
                      placeholder="Review code and report risks"
                      readOnly={state.locked()}
                      onInput={(event) => state.setDesc(event.currentTarget.value)}
                    />
                  </FieldCard>
                  <FieldCard label="Mode">
                    <CustomSelect
                      label="Agent mode"
                      value={state.mode()}
                      options={modes}
                      disabled={state.locked()}
                      onSelect={state.setMode}
                    />
                  </FieldCard>
                  <FieldCard label="Color">
                    <div class="agent-color-control">
                      <input
                        class="mono"
                        value={state.color()}
                        placeholder="#0e639c"
                        readOnly={state.locked()}
                        onInput={(event) => state.setColor(event.currentTarget.value)}
                      />
                      <div class="agent-color-swatches" aria-label="Preset colors">
                        <For each={colors}>
                          {(color) => (
                            <button
                              class="agent-color-swatch"
                              classList={{ selected: state.color() === color }}
                              type="button"
                              aria-label={`Use color ${color}`}
                              disabled={state.locked()}
                              style={{ "background-color": color }}
                              onClick={() => state.setColor(color)}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                  </FieldCard>
                  <FieldCard label="Max steps" description="Optional hard cap on tool-call iterations.">
                    <input
                      class="mono"
                      value={state.steps()}
                      placeholder="optional"
                      inputMode="numeric"
                      readOnly={state.locked()}
                      onInput={(event) => state.setSteps(event.currentTarget.value)}
                    />
                  </FieldCard>
                </div>
              </Card>

              <Card class="ui-card agent-builder-card" padding={0}>
                <header class="ui-card-header">
                  <div>
                    <h2>Model And Tools</h2>
                    <p>Choose the model and default tool access written into the agent frontmatter.</p>
                  </div>
                </header>
                <div class="ui-form agent-builder-form">
                  <FieldCard
                    label="Model"
                    actions={
                      <>
                        <Show when={!state.locked() && state.model()}>
                          <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.clearModel}>
                            Use Default
                          </Button>
                        </Show>
                        <IconButton
                          icon="edit"
                          variant="secondary"
                          aria-label="Edit agent model"
                          disabled={Boolean(state.ctx.saving()) || state.locked()}
                          onClick={state.openModel}
                        />
                      </>
                    }
                  >
                    <Show
                      when={state.selected()}
                      fallback={
                        <>
                          <strong>{state.model() || "Inherit default model"}</strong>
                          <Show when={state.model()}>{(value) => <span class="mono">{value()}</span>}</Show>
                        </>
                      }
                    >
                      {(model) => (
                        <>
                          <strong>{`${model().provider.name} / ${model().model.name}`}</strong>
                          <span class="mono">{model().id}</span>
                        </>
                      )}
                    </Show>
                  </FieldCard>
                  <FieldCard
                    label="Tool access"
                    description="Selected tools are written as allow permissions."
                    actions={
                      <>
                        <Show when={!state.locked() && state.tools().length}>
                          <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.clearTools}>
                            Clear
                          </Button>
                        </Show>
                        <IconButton
                          icon="edit"
                          variant="secondary"
                          aria-label="Edit tool access"
                          disabled={Boolean(state.ctx.saving()) || state.locked()}
                          onClick={state.openTools}
                        />
                      </>
                    }
                  >
                    <Show
                      when={state.tools().length}
                      fallback={
                        <>
                          <strong>No tools selected</strong>
                          <span>No allow permissions will be written.</span>
                        </>
                      }
                    >
                      <strong>{countTools(state.tools())}</strong>
                      <div class="tag-cloud agent-tool-summary">
                        <For each={state.tools()}>{(tool) => <Tag>{tool}</Tag>}</For>
                      </div>
                    </Show>
                  </FieldCard>
                </div>
              </Card>

              <Card class="ui-card agent-builder-card" padding={0}>
                <header class="ui-card-header">
                  <div>
                    <h2>System Prompt</h2>
                    <p>Markdown instructions that define how this agent behaves.</p>
                  </div>
                </header>
                <div class="ui-form agent-builder-form">
                  <FieldCard label="Prompt">
                    <textarea
                      class="mono agent-prompt-input"
                      value={state.prompt()}
                      placeholder="Describe how this agent should behave."
                      readOnly={state.locked()}
                      onInput={(event) => state.setPrompt(event.currentTarget.value)}
                    />
                  </FieldCard>
                  <div class="agent-snippets">
                    <div class="block-title">
                      <strong>Prompt snippets</strong>
                      <span>Insert a starter instruction into the prompt, then customize it.</span>
                    </div>
                    <div class="snippet-list">
                      <For each={snippets}>
                        {(snippet) => (
                          <Button
                            variant="secondary"
                            disabled={Boolean(state.ctx.saving()) || state.locked()}
                            onClick={() => state.insert(snippet)}
                          >
                            {snippet}
                          </Button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Card>

              <Card class="ui-card agent-builder-card" padding={0}>
                <header class="ui-card-header">
                  <div>
                    <h2>Agent Permissions</h2>
                    <p>Add scalar or pattern-specific overrides before previewing markdown.</p>
                  </div>
                  <CountTag>{state.rules().length}</CountTag>
                </header>
                <div class="ui-card-body agent-permissions-body">
                  <div class="permissions agent-permissions">
                    <For each={state.permissionGroups()}>
                      {(group) => (
                        <section class="permission-group">
                          <header class="permission-group-header">
                            <div class="permission-group-copy">
                              <h2>{group.title}</h2>
                              <span>{group.id}</span>
                              <p>{group.description}</p>
                            </div>
                            <div class="permission-section-actions">
                              <CountTag>{group.rules.length}</CountTag>
                              <Button
                                icon="plus"
                                variant="primary"
                                disabled={Boolean(state.ctx.saving()) || state.locked()}
                                onClick={() => state.openPermission(group.id)}
                              >
                                Add rule
                              </Button>
                            </div>
                          </header>

                          <ConfigRow
                            title="Default method"
                            subtitle={`Used for ${group.noun}s that do not match a specific rule.`}
                            actions={
                              <ActionSelect
                                label={`Default method for ${group.title}`}
                                value={group.action}
                                disabled={Boolean(state.ctx.saving()) || state.locked()}
                                onSelect={(action) => state.setPermissionDefault(group.id, action)}
                              />
                            }
                          />

                          <div class="permission-rules">
                            <Show
                              when={group.rules.length}
                              fallback={<p class="permission-empty">No specific {group.noun} rules.</p>}
                            >
                              <For each={group.rules}>
                                {(rule) => (
                                  <ConfigRow
                                    title={<span class="permission-pattern">{rule.pattern}</span>}
                                    subtitle={`${group.title} ${group.noun} rule`}
                                    status={<AgentRuleMeta action={rule.action} />}
                                    actions={
                                      <IconButton
                                        icon="trash"
                                        variant="ghost"
                                        aria-label={`Delete ${group.title} rule ${rule.pattern}`}
                                        disabled={Boolean(state.ctx.saving()) || state.locked()}
                                        onClick={() => state.removePermission(rule)}
                                      />
                                    }
                                  />
                                )}
                              </For>
                            </Show>
                          </div>
                        </section>
                      )}
                    </For>

                    <section class="permission-group">
                      <SectionTitle
                        trailing={<CountTag>{state.permissionDefaults().length}</CountTag>}
                        description="Default methods for additional built-in tool permissions."
                      >
                        Tool Defaults
                      </SectionTitle>
                      <div class="permission-rules">
                        <For each={state.permissionDefaults()}>
                          {(item) => (
                            <ConfigRow
                              title={item.title}
                              subtitle={`${item.id} · ${item.description}`}
                              actions={
                                <ActionSelect
                                  label={`Default method for ${item.title}`}
                                  value={item.action}
                                  disabled={Boolean(state.ctx.saving()) || state.locked()}
                                  onSelect={(action) => state.setPermissionDefault(item.id, action)}
                                />
                              }
                            />
                          )}
                        </For>
                      </div>
                    </section>

                    <Show when={state.permissionOther().length}>
                      <section class="permission-group">
                        <SectionTitle
                          trailing={<CountTag>{state.permissionOther().length}</CountTag>}
                          description="Additional tool permission rules from this agent."
                        >
                          Other Permissions
                        </SectionTitle>
                        <div class="permission-rules">
                          <For each={state.permissionOther()}>
                            {(rule) => (
                              <ConfigRow
                                title={toolName(rule.tool)}
                                subtitle={
                                  <span class="permission-subtitle">
                                    <span>{rule.tool}</span>
                                    <span class="permission-pattern">{rule.pattern}</span>
                                  </span>
                                }
                                status={<AgentRuleMeta action={rule.action} />}
                                actions={
                                  <IconButton
                                    icon="trash"
                                    variant="ghost"
                                    aria-label={`Delete ${rule.tool} rule ${rule.pattern}`}
                                    disabled={Boolean(state.ctx.saving()) || state.locked()}
                                    onClick={() => state.removePermission(rule)}
                                  />
                                }
                              />
                            )}
                          </For>
                        </div>
                      </section>
                    </Show>
                  </div>
                </div>
              </Card>
            </section>
          </div>

          <Show when={state.panel() === "model"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer" aria-label="Agent model selector">
              <header class="drawer-header">
                <div>
                  <h2>Choose Model</h2>
                  <span>Favorites are listed first, then models are sorted alphabetically.</span>
                </div>
                <Button variant="ghost" aria-label="Close model selector" onClick={state.close}>
                  X
                </Button>
              </header>

              <SearchField
                class="drawer-search"
                hideLabel={false}
                label="Filter models"
                value={state.picker()}
                variant="drawer"
                placeholder="Search by name, provider, or ID"
                onValue={state.setPicker}
              />

              <div class="provider-picker model-picker">
                <Show when={state.models().length} fallback={<p class="empty">No models match this filter.</p>}>
                  <For each={state.models()}>
                    {(item) => (
                      <button
                        class="provider-option model-option"
                        classList={{ selected: state.choice() === item.id }}
                        type="button"
                        onClick={() => state.selectModel(item)}
                      >
                        <span class="model-star" classList={{ active: state.fav(item) }} aria-hidden="true" />
                        <div>
                          <strong>{item.model.name}</strong>
                          <span>{item.id}</span>
                        </div>
                        <div class="tags">
                          <Tag>{item.provider.name}</Tag>
                          <Tag>{item.model.isFree ? "free" : "paid"}</Tag>
                        </div>
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <footer class="drawer-footer">
                <Button variant="ghost" onClick={state.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={Boolean(state.ctx.saving()) || state.locked() || !state.choice()}
                  onClick={state.saveModel}
                >
                  Save
                </Button>
              </footer>
            </aside>
          </Show>

          <Show when={state.panel() === "tools"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer" aria-label="Agent tool access selector">
              <header class="drawer-header">
                <div>
                  <h2>Choose Tool Access</h2>
                  <span>Selected tools are written as allow permissions in the agent frontmatter.</span>
                </div>
                <Button variant="ghost" aria-label="Close tool selector" onClick={state.close}>
                  X
                </Button>
              </header>

              <SearchField
                class="drawer-search"
                hideLabel={false}
                label="Filter tools"
                value={state.search()}
                variant="drawer"
                placeholder="Search by tool name, ID, or capability"
                onValue={state.setSearch}
              />

              <div class="provider-picker tool-picker">
                <Show when={state.options().length} fallback={<p class="empty">No tools match this filter.</p>}>
                  <For each={state.options()}>
                    {(tool) => (
                      <button
                        class="provider-option tool-option"
                        classList={{ selected: state.pickedDraft().has(tool.id) }}
                        aria-pressed={state.pickedDraft().has(tool.id)}
                        type="button"
                        onClick={() => state.toggleTool(tool.id)}
                      >
                        <div class="model-main tool-main">
                          <div class="model-title">
                            <div>
                              <strong>{toolName(tool.id)}</strong>
                              <span>{tool.id}</span>
                            </div>
                          </div>
                          <div class="tags">
                            <Tag>{state.pickedDraft().has(tool.id) ? "Allowed" : "Off"}</Tag>
                          </div>
                        </div>
                        <ul class="tool-capabilities">
                          <For each={toolCapabilities(tool)}>{(cap) => <li>{cap}</li>}</For>
                        </ul>
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <footer class="drawer-footer">
                <Button variant="ghost" onClick={state.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={Boolean(state.ctx.saving()) || state.locked()}
                  onClick={state.saveTools}
                >
                  Save
                </Button>
              </footer>
            </aside>
          </Show>

          <Show when={state.panel() === "permission"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer permission-drawer" aria-label="Agent permission rule configuration">
              <header class="drawer-header">
                <div>
                  <h2>{`Add ${state.selectedPermission().title} Rule`}</h2>
                  <span>{`${state.selectedPermission().id} · ${state.selectedPermission().description}`}</span>
                </div>
                <Button variant="ghost" aria-label="Close permission rule overlay" onClick={state.close}>
                  X
                </Button>
              </header>

              <div class="provider-form permission-form">
                <label class="required-field wide">
                  {state.selectedPermission().noun === "command" ? "Command pattern" : "Path pattern"}
                  <input
                    value={state.permPattern()}
                    placeholder={state.selectedPermission().placeholder}
                    spellcheck={false}
                    readOnly={state.locked()}
                    onInput={(event) => state.setPermPattern(event.currentTarget.value)}
                  />
                </label>
                <label class="required-field wide">
                  Method
                  <ActionSelect
                    label="Rule method"
                    value={state.permAction()}
                    disabled={Boolean(state.ctx.saving()) || state.locked()}
                    onSelect={state.setPermAction}
                  />
                </label>
              </div>

              <footer class="drawer-footer">
                <Button variant="ghost" onClick={state.close}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={Boolean(state.ctx.saving()) || state.locked()}
                  onClick={state.addPermission}
                >
                  Save Rule
                </Button>
              </footer>
            </aside>
          </Show>

          <Show when={state.panel() === "markdown"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer" aria-label="Generated agent markdown">
              <header class="drawer-header">
                <div>
                  <h2>Markdown</h2>
                  <span>{state.draft()?.path ?? "Previewing the current agent configuration."}</span>
                </div>
                <Button variant="ghost" aria-label="Close markdown preview" onClick={state.close}>
                  X
                </Button>
              </header>

              <div class="provider-picker markdown-picker">
                <Show when={state.draft()} fallback={<p class="empty">Generating markdown preview...</p>}>
                  {(draft) => <pre class="markdown-preview">{draft().markdown}</pre>}
                </Show>
              </div>
            </aside>
          </Show>
        </ConfigPage>
      )}
    </Show>
  )
}
