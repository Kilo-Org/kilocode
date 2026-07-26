import type { PermissionRequest } from "../../types/messages"

export interface ModeSwitchDetails {
  source: string
  target: string
  reason: string
}

export const MODE_SWITCH_TRANSITION_ICON = "arrow-right" as const

function text(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

export function permissionModeSwitch(request: PermissionRequest): ModeSwitchDetails | undefined {
  if (request.toolName !== "mode_switch") return
  const source = request.args?.source
  const target = request.args?.target
  const reason = request.args?.reason
  if (typeof source !== "string" || typeof target !== "string" || typeof reason !== "string") return
  if (!source.trim() || !target.trim() || !reason.trim()) return
  return { source, target, reason }
}

export function modeSwitchEvent(
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
): { title: string; reason?: string } {
  const source = text(metadata.source)
  const target = text(metadata.target) ?? text(input.target)
  const reason = text(metadata.reason) ?? text(input.reason)
  const outcome = text(metadata.status)

  if (outcome === "switched" && source && target) return { title: `Mode switched: ${source} → ${target}`, reason }
  if (outcome === "continued" && source) return { title: `Mode switch cancelled · Task continues in ${source}` }
  if (outcome === "stopped") return { title: "Mode switch cancelled · Task stopped" }
  if (target) return { title: `Switching to ${target}…`, reason }
  return { title: "Switching mode…", reason }
}
