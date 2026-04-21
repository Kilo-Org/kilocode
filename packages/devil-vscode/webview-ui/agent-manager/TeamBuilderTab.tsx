/**
 * TeamBuilderTab — Agent Manager tab for viewing and editing team configurations.
 *
 * Sends/receives messages via the extension's teamBuilder.* channel.
 * Kept intentionally simple for v1 — no deep config editing, just name + role list.
 */
import { createSignal, For, Show, onMount, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useVSCode } from "../src/context/vscode"
import type {
  TeamBuilderTeamsListMessage,
  TeamBuilderTeamLoadedMessage,
  TeamBuilderSavedMessage,
  TeamBuilderErrorMessage,
} from "../src/types/messages"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamHandle {
  id: string
  name: string
  isQuickstart: boolean
}

interface TeamRole {
  positionId: string
  displayName?: string
  provider: string
  model: string
  effort: string
}

interface TeamConfig {
  name?: string
  roles: TeamRole[]
}

interface TeamBuilderLocalState {
  teams: TeamHandle[]
  selectedTeamId: string | null
  draft: TeamConfig
  loading: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// Stage coverage calculation (7 canonical stages)
// ---------------------------------------------------------------------------

const ALL_STAGES = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]

function computeCoveredStages(roles: TeamRole[]): number {
  const covered = new Set<string>()
  for (const role of roles) {
    // Each role covers its positionId if it matches a stage name
    const id = role.positionId.toLowerCase()
    for (const stage of ALL_STAGES) {
      if (id.includes(stage)) covered.add(stage)
    }
  }
  return covered.size
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamBuilderTab(): JSX.Element {
  const vscode = useVSCode()

  const [state, setState] = createStore<TeamBuilderLocalState>({
    teams: [],
    selectedTeamId: null,
    draft: { name: "", roles: [] },
    loading: false,
    error: null,
  })

  const [saving, setSaving] = createSignal(false)
  const [savedFlash, setSavedFlash] = createSignal(false)

  // -------------------------------------------------------------------------
  // Message listener
  // -------------------------------------------------------------------------

  onMount(() => {
    const unsub = vscode.onMessage((msg) => {
      if (msg.type === "teamBuilder.teamsList") {
        const m = msg as TeamBuilderTeamsListMessage
        setState("teams", m.teams)
        setState("loading", false)
        setState("error", null)
        return
      }

      if (msg.type === "teamBuilder.teamLoaded") {
        const m = msg as TeamBuilderTeamLoadedMessage
        const config = (m.config ?? {}) as TeamConfig
        setState("draft", {
          name: config.name ?? "",
          roles: Array.isArray(config.roles) ? config.roles : [],
        })
        setState("loading", false)
        setState("error", null)
        return
      }

      if (msg.type === "teamBuilder.saved") {
        const m = msg as TeamBuilderSavedMessage
        setSaving(false)
        if (m.success) {
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 2000)
        } else {
          setState("error", m.error ?? "Save failed")
        }
        return
      }

      if (msg.type === "teamBuilder.error") {
        const m = msg as TeamBuilderErrorMessage
        setState("error", m.message)
        setState("loading", false)
        setSaving(false)
        return
      }
    })

    // Request initial team list
    setState("loading", true)
    vscode.postMessage({ type: "teamBuilder.listTeams" })

    onCleanup(unsub)
  })

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSelectTeam = (teamId: string) => {
    setState("selectedTeamId", teamId)
    setState("loading", true)
    setState("error", null)
    vscode.postMessage({ type: "teamBuilder.loadTeam", teamId })
  }

  const handleSave = () => {
    const teamId = state.selectedTeamId
    if (!teamId) return
    setSaving(true)
    vscode.postMessage({ type: "teamBuilder.saveTeam", teamId, config: state.draft })
  }

  const handleNameChange = (value: string) => {
    setState("draft", "name", value)
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const coveredCount = () => computeCoveredStages(state.draft.roles)

  return (
    <div class="tb-layout">
      {/* Sidebar: team list */}
      <div class="tb-sidebar">
        <div class="tb-sidebar-header">
          <span class="tb-sidebar-title">Teams</span>
          <button
            class="tb-refresh-btn"
            title="Refresh team list"
            onClick={() => {
              setState("loading", true)
              vscode.postMessage({ type: "teamBuilder.listTeams" })
            }}
          >
            ↺
          </button>
        </div>

        <Show when={state.loading && state.teams.length === 0}>
          <div class="tb-loading">Loading…</div>
        </Show>

        <Show when={!state.loading && state.teams.length === 0}>
          <div class="tb-empty">No teams found.</div>
        </Show>

        <For each={state.teams}>
          {(team) => (
            <button
              class={`tb-team-item ${state.selectedTeamId === team.id ? "tb-team-item-active" : ""}`}
              onClick={() => handleSelectTeam(team.id)}
            >
              <span class="tb-team-name">{team.name}</span>
              <Show when={team.isQuickstart}>
                <span class="tb-quickstart-badge">quickstart</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* Main panel: team editor */}
      <div class="tb-main">
        <Show when={state.error}>
          <div class="tb-error">{state.error}</div>
        </Show>

        <Show when={!state.selectedTeamId}>
          <div class="tb-placeholder">Select a team to view and edit its configuration.</div>
        </Show>

        <Show when={state.selectedTeamId}>
          <Show when={state.loading}>
            <div class="tb-loading">Loading team…</div>
          </Show>

          <Show when={!state.loading}>
            <div class="tb-editor">
              {/* Team name */}
              <div class="tb-field-group">
                <label class="tb-label" for="tb-team-name">
                  Team Name
                </label>
                <input
                  id="tb-team-name"
                  class="tb-input"
                  type="text"
                  value={state.draft.name ?? ""}
                  onInput={(e) => handleNameChange((e.target as HTMLInputElement).value)}
                />
              </div>

              {/* Stage coverage */}
              <div class="tb-coverage">
                <span class="tb-coverage-label">Stage coverage:</span>
                <span class="tb-coverage-count">
                  {coveredCount()}/{ALL_STAGES.length} stages covered
                </span>
              </div>

              {/* Role list */}
              <div class="tb-roles-section">
                <div class="tb-roles-header">Roles ({state.draft.roles.length})</div>
                <Show when={state.draft.roles.length === 0}>
                  <div class="tb-roles-empty">No roles configured for this team.</div>
                </Show>
                <Show when={state.draft.roles.length > 0}>
                  <table class="tb-roles-table">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Display Name</th>
                        <th>Provider</th>
                        <th>Model</th>
                        <th>Effort</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={state.draft.roles}>
                        {(role) => (
                          <tr>
                            <td>{role.positionId}</td>
                            <td>{role.displayName ?? "—"}</td>
                            <td>{role.provider}</td>
                            <td class="tb-model-cell">{role.model}</td>
                            <td>{role.effort}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </div>

              {/* Save controls */}
              <div class="tb-actions">
                <button class="tb-save-btn" onClick={handleSave} disabled={saving()}>
                  {saving() ? "Saving…" : "Save Team"}
                </button>
                <Show when={savedFlash()}>
                  <span class="tb-saved-flash">Saved!</span>
                </Show>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
