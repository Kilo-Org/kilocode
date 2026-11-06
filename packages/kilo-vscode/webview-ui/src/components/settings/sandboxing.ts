export type SandboxNetwork = "allow" | "deny"

export type SandboxConfig = {
  enabled?: boolean
  network?: SandboxNetwork
  writable_paths?: string[]
  allowed_hosts?: string[]
}

type Globals = { KILO_SANDBOX_CONTROLS?: boolean }

/** The host inlines whether this platform supports the sandbox controls; Windows hides them. */
function globals(): Globals | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as Globals & typeof window)
}

export function sandboxControls(): boolean {
  return globals()?.KILO_SANDBOX_CONTROLS !== false
}

export function visible(controls: boolean = sandboxControls()) {
  return controls
}

export function sandboxConfig(source: unknown): SandboxConfig {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {}
  const value = source as Record<string, unknown>
  const network = value.network === "allow" || value.network === "deny" ? value.network : undefined
  const paths = Array.isArray(value.writable_paths)
    ? value.writable_paths.filter((item): item is string => typeof item === "string")
    : undefined
  const hosts = Array.isArray(value.allowed_hosts)
    ? value.allowed_hosts.filter((item): item is string => typeof item === "string")
    : undefined
  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    ...(network ? { network } : {}),
    ...(paths ? { writable_paths: paths } : {}),
    ...(hosts ? { allowed_hosts: hosts } : {}),
  }
}

export function withSandbox(current: SandboxConfig, patch: Partial<SandboxConfig>): SandboxConfig {
  return { ...current, ...patch }
}

/** Normalizes an allowed destination to `host:port`, or undefined when it is not a valid host and port. */
export function destination(input: string) {
  const match = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/.exec(input)
  if (!match) return
  if (/^[0-9.]+$/.test(match[1]) || match[1].length > 253) return
  const port = Number(match[2] ?? "443")
  if (
    port < 1 ||
    port > 65535 ||
    match[1].split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))
  )
    return
  return `${match[1]}:${port}`
}
