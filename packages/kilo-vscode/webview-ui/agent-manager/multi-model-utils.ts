import type { ModelAllocation } from "../src/types/messages"
import { MAX_MULTI_VERSIONS } from "../src/types/messages"

export { MAX_MULTI_VERSIONS }

export interface ModelAllocationEntry {
  providerID: string
  modelID: string
  name: string
  count: number
}

export type ModelAllocations = Map<string, ModelAllocationEntry>

export function allocationKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

export function totalAllocations(allocations: ModelAllocations): number {
  let total = 0
  for (const entry of allocations.values()) total += entry.count
  return total
}

export function allocationsToArray(allocations: ModelAllocations): ModelAllocation[] {
  const result: ModelAllocation[] = []
  for (const entry of allocations.values()) {
    result.push({ providerID: entry.providerID, modelID: entry.modelID, count: entry.count })
  }
  return result
}

export function remaining(allocations: ModelAllocations): number {
  return MAX_MULTI_VERSIONS - totalAllocations(allocations)
}

export function toggleModel(
  allocations: ModelAllocations,
  providerID: string,
  modelID: string,
  name: string,
): ModelAllocations {
  const key = allocationKey(providerID, modelID)
  const next = new Map(allocations)
  if (next.has(key)) {
    next.delete(key)
  } else if (remaining(allocations) > 0) {
    next.set(key, { providerID, modelID, name, count: 1 })
  }
  return next
}

export function setAllocationCount(
  allocations: ModelAllocations,
  providerID: string,
  modelID: string,
  count: number,
): ModelAllocations {
  if (count < 1) return allocations
  const key = allocationKey(providerID, modelID)
  const existing = allocations.get(key)
  if (!existing) return allocations
  const delta = count - existing.count
  if (delta > 0 && delta > remaining(allocations)) return allocations
  const next = new Map(allocations)
  next.set(key, { ...existing, count })
  return next
}

export function maxAllocationCount(allocations: ModelAllocations, providerID: string, modelID: string): number {
  const key = allocationKey(providerID, modelID)
  const existing = allocations.get(key)
  const current = existing?.count ?? 0
  return current + remaining(allocations)
}
