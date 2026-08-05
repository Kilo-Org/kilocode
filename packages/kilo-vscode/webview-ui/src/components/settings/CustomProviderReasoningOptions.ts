import { REASONING_EFFORTS, type ReasoningEffort, type ReasoningOption } from "../../../../src/shared/custom-provider"

export function advanced(options: ReasoningOption[] | undefined) {
  if (!options || options.length === 0) return false
  const efforts = options.filter((option) => option.type === "effort")
  if (efforts.length > 1) return true
  return options.some(
    (option) =>
      option.type !== "effort" || option.values.some((value) => !REASONING_EFFORTS.includes(value as ReasoningEffort)),
  )
}

export function mergeMetadata(options: ReasoningOption[] | undefined, values: ReasoningEffort[]) {
  const rest = options?.filter((option) => option.type !== "effort") ?? []
  const extra =
    options
      ?.filter((option) => option.type === "effort")
      .flatMap((option) => option.values.filter((value) => !REASONING_EFFORTS.includes(value as ReasoningEffort))) ?? []
  const effort = [...values, ...extra]
  const next: ReasoningOption[] = [...rest, ...(effort.length > 0 ? [{ type: "effort" as const, values: effort }] : [])]
  return next.length > 0 ? next : undefined
}
