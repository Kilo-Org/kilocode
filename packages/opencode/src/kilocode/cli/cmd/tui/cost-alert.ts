import type { useToast } from "@tui/ui/toast"
import type { useNudge } from "@/kilocode/cli/cmd/tui/context/nudge"

export type CostAlertCommand =
  | { type: "prompt" }
  | { type: "off" }
  | { type: "set"; value: number }
  | { type: "invalid" }

export function costAlertUsage() {
  return "Usage: /cost-alert <amount|off>"
}

export function parseCostAlert(input: string): CostAlertCommand {
  const raw = input.trim()
  if (!raw) return { type: "prompt" }

  const value = raw.toLowerCase()
  if (value === "off" || value === "disable" || value === "clear") return { type: "off" }

  const text = raw.startsWith("$") ? raw.slice(1) : raw
  if (!text) return { type: "invalid" }

  // Decimal amounts only: reject JS numeric forms like 1e3, 0x10, 0b10, Infinity.
  if (!/^\d*\.?\d+$/.test(text)) return { type: "invalid" }

  const num = Number(text)
  if (!Number.isFinite(num)) return { type: "invalid" }
  if (num === 0) return { type: "off" }
  if (num < 0) return { type: "invalid" }

  return { type: "set", value: num }
}

export interface CostAlertController {
  // Prefill the prompt with "/cost-alert " so the user can type an amount.
  start: () => void
  // Intercept a submitted prompt; returns true when it was a cost-alert command.
  handle: (text: string) => boolean
}

// The prompt-mutating bits (prefill/clearPrompt) stay with the component; this owns
// the parsing, nudge calls, and toast messaging so they live under kilocode/.
export function createCostAlertController(deps: {
  prefill: () => void
  clearPrompt: () => void
  toast: ReturnType<typeof useToast>
  nudge: ReturnType<typeof useNudge>
  sessionID: () => string | undefined
}): CostAlertController {
  const { prefill, clearPrompt, toast, nudge, sessionID } = deps

  function handle(text: string): boolean {
    const [head = "", ...parts] = text.split(/\s+/)
    const name = head.startsWith("/") ? head.slice(1) : ""
    if (name !== "cost-alert" && name !== "cost") return false

    const command = parseCostAlert(parts.join(" "))
    if (command.type === "prompt") {
      prefill()
      toast.show({ message: costAlertUsage(), variant: "info", duration: 4000 })
      return true
    }

    if (command.type === "invalid") {
      toast.show({ message: costAlertUsage(), variant: "error", duration: 4000 })
      return true
    }

    const sid = sessionID()
    if (command.type === "off") {
      const info = nudge.clearLimit(sid)
      clearPrompt()
      toast.show({
        message: sid ? `Cost alert disabled. Current cost ${nudge.formatCost(info.cost)}.` : "Cost alert disabled.",
        variant: "success",
        duration: 4000,
      })
      return true
    }

    const info = nudge.setLimit(sid, command.value)
    clearPrompt()
    toast.show({
      message: sid
        ? `Cost alert set to ${nudge.formatCost(info.limit)}. Current cost ${nudge.formatCost(info.cost)}.`
        : `Cost alert set to ${nudge.formatCost(info.limit)}.`,
      variant: "success",
      duration: 4000,
    })
    return true
  }

  return { start: prefill, handle }
}
