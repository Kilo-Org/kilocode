// Draft persistence for the New Worktree dialog. The draft lives in webview
// state, which the Agent Manager serializer keeps across a Reload window.

import {
  MAX_MULTI_VERSIONS,
  allocationKey,
  type ModelAllocationEntry,
  type ModelAllocations,
} from "./multi-model-utils"

export type VersionCount = 1 | 2 | 3 | 4

export interface WorktreeDraft {
  project?: string
  name?: string
  branch?: string
  versions?: VersionCount
  compare?: boolean
  allocations?: ModelAllocationEntry[]
  goal?: boolean
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function version(value: unknown): VersionCount | undefined {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
}

function copy(data: ModelAllocationEntry): ModelAllocationEntry {
  const item: ModelAllocationEntry = {
    providerID: data.providerID,
    modelID: data.modelID,
    name: data.name,
    count: data.count,
  }
  if (data.variant) item.variant = data.variant
  return item
}

function allocation(value: unknown): ModelAllocationEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  if (typeof data.providerID !== "string" || typeof data.modelID !== "string" || typeof data.name !== "string")
    return undefined
  if (
    typeof data.count !== "number" ||
    !Number.isInteger(data.count) ||
    data.count < 1 ||
    data.count > MAX_MULTI_VERSIONS
  )
    return undefined
  return copy({ ...data, variant: text(data.variant) } as ModelAllocationEntry)
}

/** Initial signal values for a restored draft. */
export function draftValues(draft: WorktreeDraft) {
  const allocations: ModelAllocations = new Map()
  for (const item of draft.allocations ?? []) allocations.set(allocationKey(item.providerID, item.modelID), copy(item))
  return {
    name: draft.name ?? "",
    branch: draft.branch ?? "",
    versions: draft.versions ?? 1,
    compare: draft.compare === true,
    goal: draft.goal === true,
    allocations,
  }
}

/**
 * The project to open on. An explicit row click that differs from the active
 * project wins; otherwise restore a saved project only while it still exists,
 * and fall back to today's default.
 */
export function initialProject(
  draft: WorktreeDraft,
  list: Array<{ id: string }>,
  explicit: string | undefined,
  active: string | undefined,
): string | undefined {
  if (explicit != null && explicit !== active) return explicit
  if (draft.project && list.some((item) => item.id === draft.project)) return draft.project
  return explicit ?? active
}

/** Read the draft from cached webview state. */
export function readCached(state: Record<string, unknown> | undefined): WorktreeDraft {
  const value = state?.advancedDialogDraft
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const data = value as Record<string, unknown>
  const list = Array.isArray(data.allocations)
    ? data.allocations.map(allocation).filter((item): item is ModelAllocationEntry => item !== undefined)
    : []
  return {
    project: text(data.project),
    name: text(data.name),
    branch: text(data.branch),
    versions: version(data.versions),
    compare: data.compare === true ? true : undefined,
    allocations: list.length > 0 ? list : undefined,
    goal: data.goal === true ? true : undefined,
  }
}

/** Persist only meaningful values so an untouched draft stays empty. */
export function writeDraft(draft: WorktreeDraft): WorktreeDraft | undefined {
  const next: WorktreeDraft = {}
  if (draft.project) next.project = draft.project
  if (draft.name) next.name = draft.name
  if (draft.branch) next.branch = draft.branch
  if (draft.versions && draft.versions > 1) next.versions = draft.versions
  if (draft.compare) next.compare = true
  if (draft.allocations && draft.allocations.length > 0) next.allocations = draft.allocations
  if (draft.goal) next.goal = true
  return Object.keys(next).length > 0 ? next : undefined
}

export function writeAllocations(map: ModelAllocations): ModelAllocationEntry[] | undefined {
  if (map.size === 0) return undefined
  return [...map.values()].map(copy)
}
