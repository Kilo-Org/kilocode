import type { StackPhase } from "../state/stack"

const steps = [
  { id: "vertical", label: "Vertical" },
  { id: "category", label: "Technologies" },
  { id: "resources", label: "Resources" },
  { id: "review", label: "Review" },
] as const

export function position(phase: StackPhase, index: number, count: number) {
  if (phase === "result") return steps.length
  const found = steps.findIndex((item) => item.id === phase)
  const step = found < 0 ? 0 : found
  if (phase !== "category" || count <= 0) return step
  const offset = Math.max(0, Math.min(index, count - 1))
  return step + offset / count
}
