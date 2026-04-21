// packages/opencode/src/devilcode/workflow-tui/views/team-builder-context.tsx
/**
 * TeamBuilderProvider — Phase 4 team-building state machine.
 *
 * Parallel to WorkflowProvider (NOT nested) so Phase 5 cockpit redesign can
 * refactor WorkflowViewState without destabilizing the builder.
 */
import { createContext, useContext, type ParentProps, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { CanonicalTeamConfig, type CanonicalTeamRole } from "../../team/config"
import { POSITION_LIBRARY, type CanonicalPosition } from "../../team/library"
import { loadQuickstartTemplates } from "../../team/quickstarts"
import { createFileSystemTeamRepository, type TeamRepository } from "../../team/repository"
// devilcode_change start — Phase 7: DAG state integration
import { generateDefaultDAG, validateDAG } from "../../team/dag"
import type { WorkflowDAG, DAGOverride, DAGError } from "../../team/dag"
import type { CanonicalCapability } from "../../team/capabilities"
// devilcode_change end

export type SaveStatus = "idle" | "saving" | "saved" | "error"

export type TeamBuilderState = {
  draft: Partial<CanonicalTeamConfig>
  teamId: string
  selectedRole: string | null
  pickerOpen: boolean
  quickstartOpen: boolean
  saveStatus: SaveStatus
  saveError: string | null
  loadedQuickstart: string | null
  // devilcode_change start — Phase 7: DAG state
  dagDraft: DAGOverride | null
  dagErrors: DAGError[]
  advancedMode: boolean
  // devilcode_change end
}

export type TeamBuilderActions = {
  setTeamId(id: string): void
  addRole(positionId: string): void
  removeRole(positionId: string): void
  editRole(positionId: string, field: string, value: unknown): void
  loadQuickstart(id: string): void
  save(): Promise<void>
  validateAndStartBuild(startBuild: (config: CanonicalTeamConfig) => Promise<unknown>): Promise<void>
  openPicker(): void
  closePicker(): void
  openQuickstart(): void
  closeQuickstart(): void
  /**
   * Closes both the position picker and the quickstart overlay in a single atomic update.
   * Useful for ESC-key handlers and "Cancel" buttons that need to dismiss any open overlay
   * regardless of which one is currently showing.
   *
   * Explicitly does NOT clear selectedRole, saveError, or draft — those are content state.
   */
  closeOverlays(): void
  reset(): void
  /**
   * Sets the selectedRole in the store.
   * Does NOT close any overlays — overlay lifecycle is owned by the overlay itself
   * or by closeOverlays().
   */
  selectRole(id: string | null): void
  // devilcode_change start — Phase 7: DAG actions
  setAdvancedMode(enabled: boolean): void
  updateDAG(dag: WorkflowDAG): void
  resetDAGToDefault(): void
  // devilcode_change end
}

export type TeamBuilderContextValue = TeamBuilderState & TeamBuilderActions

const TeamBuilderCtx = createContext<TeamBuilderContextValue>()

export type TeamBuilderProviderProps = ParentProps & {
  repository?: TeamRepository
}

export function TeamBuilderProvider(props: TeamBuilderProviderProps): JSX.Element {
  const repo = props.repository ?? createFileSystemTeamRepository()

  const [store, setStore] = createStore<TeamBuilderState>({
    draft: {},
    teamId: "my-team",
    selectedRole: null,
    pickerOpen: false,
    quickstartOpen: false,
    saveStatus: "idle",
    saveError: null,
    loadedQuickstart: null,
    // devilcode_change start — Phase 7: DAG initial state
    dagDraft: null,
    dagErrors: [],
    advancedMode: false,
    // devilcode_change end
  })

  const actions: TeamBuilderActions = {
    setTeamId(id: string) {
      setStore("teamId", id)
    },

    addRole(positionId: string) {
      const entry = POSITION_LIBRARY[positionId as CanonicalPosition]
      if (!entry) return
      const newRole: CanonicalTeamRole = {
        displayName: entry.displayName,
        positionId: entry.id,
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        effort: "default",
        tier: entry.tier,
        canDelegate: [...entry.defaultCanDelegate],
        maxConcurrent: 3,
        capabilities: [...entry.canonicalCapabilities],
        supplementaryCapabilities: [],
      }
      setStore(
        produce((s) => {
          if (!s.draft.roles) s.draft.roles = {}
          s.draft.roles[positionId] = newRole
        }),
      )
    },

    removeRole(positionId: string) {
      setStore(
        produce((s) => {
          if (!s.draft.roles) return
          delete s.draft.roles[positionId]
        }),
      )
    },

    editRole(positionId: string, field: string, value: unknown) {
      setStore(
        produce((s) => {
          if (!s.draft.roles || !s.draft.roles[positionId]) return
          ;(s.draft.roles[positionId] as Record<string, unknown>)[field] = value
        }),
      )
    },

    loadQuickstart(id: string) {
      const templates = loadQuickstartTemplates()
      const tpl = templates[id as keyof typeof templates]
      if (!tpl) return
      setStore(
        produce((s) => {
          s.draft = { ...tpl.team }
          s.loadedQuickstart = id
          s.saveStatus = "idle"
          s.saveError = null
        }),
      )
    },

    async save() {
      setStore("saveStatus", "saving")
      setStore("saveError", null)
      try {
        // devilcode_change start — Phase 7: persist workflowOverride when valid
        const workflowOverride =
          store.advancedMode && store.dagDraft && store.dagErrors.length === 0
            ? store.dagDraft
            : undefined
        await repo.saveTeam(store.teamId, { ...store.draft, workflowOverride } as CanonicalTeamConfig)
        // devilcode_change end
        setStore("saveStatus", "saved")
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setStore("saveStatus", "error")
        setStore("saveError", msg)
      }
    },

    async validateAndStartBuild(startBuild) {
      // devilcode_change start — Phase 7: include workflowOverride when valid
      const workflowOverride =
        store.advancedMode && store.dagDraft && store.dagErrors.length === 0
          ? store.dagDraft
          : undefined
      const result = CanonicalTeamConfig.safeParse({ ...store.draft, enabled: true, workflowOverride })
      // devilcode_change end
      if (!result.success) {
        const issues = result.error.issues
        setStore("saveError", issues.map((i) => i.message).join("; "))
        return
      }
      setStore("saveError", null)
      await startBuild(result.data)
    },

    openPicker() {
      setStore("pickerOpen", true)
    },

    closePicker() {
      setStore("pickerOpen", false)
    },

    openQuickstart() {
      setStore("quickstartOpen", true)
    },

    closeQuickstart() {
      setStore("quickstartOpen", false)
    },

    closeOverlays() {
      setStore("pickerOpen", false)
      setStore("quickstartOpen", false)
      // Explicitly does NOT clear selectedRole, saveError, draft — those are content state.
    },

    reset() {
      setStore(
        produce((s) => {
          s.draft = {}
          s.selectedRole = null
          s.pickerOpen = false
          s.quickstartOpen = false
          s.saveStatus = "idle"
          s.saveError = null
          s.loadedQuickstart = null
          // devilcode_change start — Phase 7: also reset DAG state
          s.dagDraft = null
          s.dagErrors = []
          s.advancedMode = false
          // devilcode_change end
        }),
      )
    },

    selectRole(id: string | null) {
      setStore("selectedRole", id)
    },

    // devilcode_change start — Phase 7: DAG actions
    setAdvancedMode(enabled: boolean) {
      setStore("advancedMode", enabled)
      if (enabled && !store.dagDraft) {
        setStore("dagDraft", { dag: generateDefaultDAG() })
      }
    },

    updateDAG(dag: WorkflowDAG) {
      setStore("dagDraft", { ...(store.dagDraft ?? {}), dag })
      // R2-03: null-safety for roles
      const capMap = new Map<CanonicalCapability, boolean>()
      const roles = store.draft?.roles
      if (roles && typeof roles === "object") {
        for (const role of Object.values(roles)) {
          const typedRole = role as { capabilities?: string[] } | undefined
          if (typedRole?.capabilities) {
            for (const cap of typedRole.capabilities) capMap.set(cap as CanonicalCapability, true)
          }
        }
      }
      const errors = validateDAG(dag, capMap)
      setStore("dagErrors", errors)
    },

    resetDAGToDefault() {
      setStore("dagDraft", { dag: generateDefaultDAG() })
      setStore("dagErrors", [])
    },
    // devilcode_change end
  }

  const value: TeamBuilderContextValue = {
    get draft() {
      return store.draft
    },
    get teamId() {
      return store.teamId
    },
    get selectedRole() {
      return store.selectedRole
    },
    get pickerOpen() {
      return store.pickerOpen
    },
    get quickstartOpen() {
      return store.quickstartOpen
    },
    get saveStatus() {
      return store.saveStatus
    },
    get saveError() {
      return store.saveError
    },
    get loadedQuickstart() {
      return store.loadedQuickstart
    },
    // devilcode_change start — Phase 7: DAG state getters
    get dagDraft() {
      return store.dagDraft
    },
    get dagErrors() {
      return store.dagErrors
    },
    get advancedMode() {
      return store.advancedMode
    },
    // devilcode_change end
    ...actions,
  }

  return (
    <TeamBuilderCtx.Provider value={value}>
      {props.children}
    </TeamBuilderCtx.Provider>
  )
}

export function useTeamBuilder(): TeamBuilderContextValue {
  const ctx = useContext(TeamBuilderCtx)
  if (!ctx) throw new Error("useTeamBuilder must be used within TeamBuilderProvider")
  return ctx
}
