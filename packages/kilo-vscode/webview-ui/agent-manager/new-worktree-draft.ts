// Draft persistence and the one-shot reopen flag for the New Worktree dialog.
// Both live in webview state, which the Agent Manager serializer keeps across a Reload window.

import { createEffect, on, type Accessor } from "solid-js"
import { z } from "zod"
import {
  MAX_MULTI_VERSIONS,
  allocationKey,
  type ModelAllocationEntry,
  type ModelAllocations,
} from "./multi-model-utils"
import { VERSION_OPTIONS, type VersionCount } from "../../src/shared/worktree-readiness"

export type { VersionCount } from "../../src/shared/worktree-readiness"

export interface WorktreeDraft {
  project?: string
  name?: string
  branch?: string
  versions?: VersionCount
  compare?: boolean
  allocations?: ModelAllocationEntry[]
  goal?: boolean
}

const allocationSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
  name: z.string(),
  count: z.number().int().min(1).max(MAX_MULTI_VERSIONS),
  variant: z.string().min(1).optional().catch(undefined),
})

const draftSchema = z.object({
  project: z.string().min(1).optional().catch(undefined),
  name: z.string().min(1).optional().catch(undefined),
  branch: z.string().min(1).optional().catch(undefined),
  versions: z
    .number()
    .int()
    .min(1)
    .max(MAX_MULTI_VERSIONS)
    .refine((value) => VERSION_OPTIONS.some((item) => item === value))
    .optional()
    .catch(undefined),
  compare: z.literal(true).optional().catch(undefined),
  allocations: z.array(z.unknown()).optional().catch(undefined),
  goal: z.literal(true).optional().catch(undefined),
})

function copyAllocation(data: ModelAllocationEntry): ModelAllocationEntry {
  const item: ModelAllocationEntry = {
    providerID: data.providerID,
    modelID: data.modelID,
    name: data.name,
    count: data.count,
  }
  if (data.variant) item.variant = data.variant
  return item
}

function validAllocations(values: unknown[] | undefined): ModelAllocationEntry[] {
  if (!values) return []
  const items: ModelAllocationEntry[] = []
  for (const value of values) {
    const parsed = allocationSchema.safeParse(value)
    if (parsed.success) items.push(parsed.data)
  }
  return items
}

export function draftValues(draft: WorktreeDraft) {
  const allocations: ModelAllocations = new Map()
  for (const item of draft.allocations ?? [])
    allocations.set(allocationKey(item.providerID, item.modelID), copyAllocation(item))
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

const DRAFT_KEY = "advancedDialogDraft"

/** Write the draft into the persisted webview state. */
export function saveDraft(state: Record<string, unknown>, draft: WorktreeDraft): Record<string, unknown> {
  return { ...state, [DRAFT_KEY]: writeDraft(draft) }
}

export function readCached(state: Record<string, unknown> | undefined): WorktreeDraft {
  const parsed = draftSchema.safeParse(state?.[DRAFT_KEY])
  if (!parsed.success) return {}
  const data = parsed.data
  const allocations = validAllocations(data.allocations)
  return {
    project: data.project,
    name: data.name,
    branch: data.branch,
    versions: VERSION_OPTIONS.find((value) => value === data.versions),
    compare: data.compare,
    allocations: allocations.length > 0 ? allocations : undefined,
    goal: data.goal,
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
  return [...map.values()].map(copyAllocation)
}

const REOPEN_KEY = "advancedDialogReopen"

export function markReopen(state: Record<string, unknown>): Record<string, unknown> {
  return { ...state, [REOPEN_KEY]: true }
}

function readReopen(state: Record<string, unknown> | undefined): boolean {
  return state?.[REOPEN_KEY] === true
}

function takeReopen(state: Record<string, unknown> | undefined): {
  reopen: boolean
  state: Record<string, unknown>
} {
  const next = { ...(state ?? {}) }
  const reopen = readReopen(next)
  delete next[REOPEN_KEY]
  return { reopen, state: next }
}

interface ReopenOptions {
  loaded: Accessor<boolean>
  arrived: Accessor<boolean>
  state: () => Record<string, unknown> | undefined
  save: (state: Record<string, unknown>) => void
  open: () => void
}

export function createReopen(opts: ReopenOptions) {
  let done = false
  const run = () => {
    if (done || !opts.loaded() || !opts.arrived()) return
    // The first eligible run is this page's only chance. A Reload clicked after
    // it must not reopen the dialog on the page that is about to be replaced.
    done = true
    const next = takeReopen(opts.state())
    if (!next.reopen) return
    opts.save(next.state)
    opts.open()
  }
  createEffect(on([opts.loaded, opts.arrived], () => run()))
}
