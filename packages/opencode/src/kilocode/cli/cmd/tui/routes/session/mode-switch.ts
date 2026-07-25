export type Details = {
  source: string
  target: string
  reason: string
}

function text(value: unknown) {
  if (typeof value !== "string") return
  const result = value.trim()
  return result || undefined
}

export namespace ModeSwitch {
  export function details(input: Record<string, unknown>, metadata: Record<string, unknown>): Details | undefined {
    const source = text(metadata.source)
    const target = text(metadata.target) ?? text(input.target)
    const reason = text(metadata.reason) ?? text(input.reason)
    if (!source || !target || !reason) return
    return { source, target, reason }
  }

  export function event(input: Record<string, unknown>, metadata: Record<string, unknown>) {
    const current = details(input, metadata)
    const target = current?.target ?? text(input.target)
    const source = current?.source
    const reason = current?.reason ?? text(input.reason)
    const status = text(metadata.status)
    if (status === "switched" && source && target) return { title: `Mode switched: ${source} → ${target}`, reason }
    if (status === "continued" && source) return { title: `Continued in ${source}`, reason }
    if (target) return { title: `Switching to ${target}…`, reason }
    return { title: "Switching mode…", reason }
  }

  export function prompt(metadata: Record<string, unknown>) {
    const current = details({}, metadata)
    const source = current?.source ?? "current mode"
    const target = current?.target ?? "requested mode"
    return {
      heading: "Agent requests a mode change",
      title: `${source} → ${target}`,
      reason: current?.reason,
      options: { once: `Switch to ${target}`, reject: `Stay in ${source}` },
    }
  }

  export function switched(sessionID: string, event: { properties: { sessionID: string; agent: string } }) {
    if (event.properties.sessionID !== sessionID) return
    return event.properties.agent
  }
}
