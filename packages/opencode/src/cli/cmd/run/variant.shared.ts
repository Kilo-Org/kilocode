// Model variant resolution.
//
// Variants are provider-specific reasoning effort levels (e.g., "high", "max").
// Resolution priority: CLI --variant flag > session history > configured agent.
import { createSession, sessionVariant, type RunSession, type SessionMessages } from "./session.shared"
import type { RunInput, RunProvider } from "./types"

export function modelInfo(providers: RunProvider[] | undefined, model: NonNullable<RunInput["model"]>) {
  const provider = providers?.find((item) => item.id === model.providerID)
  return {
    provider: provider?.name ?? model.providerID,
    model: provider?.models[model.modelID]?.name ?? model.modelID,
  }
}

export function formatModelLabel(
  model: NonNullable<RunInput["model"]>,
  variant: string | undefined,
  providers?: RunProvider[],
): string {
  const names = modelInfo(providers, model)
  const label = variant ? ` · ${variant}` : ""
  return `${names.model} · ${names.provider}${label}`
}

export function cycleVariant(current: string | undefined, variants: string[]): string | undefined {
  if (variants.length === 0) {
    return undefined
  }

  if (!current) {
    return variants[0]
  }

  const idx = variants.indexOf(current)
  if (idx === -1 || idx === variants.length - 1) {
    return undefined
  }

  return variants[idx + 1]
}

export function pickVariant(model: RunInput["model"], input: RunSession | SessionMessages): string | undefined {
  return sessionVariant(Array.isArray(input) ? createSession(input) : input, model)
}

function fitVariant(value: string | undefined, variants: string[]): string | undefined {
  if (!value) {
    return undefined
  }

  if (value === "default") {
    return value // kilocode_change - preserve the explicit provider-default sentinel
  }

  if (variants.length === 0 || variants.includes(value)) {
    return value
  }

  return undefined
}

// Picks the active variant. CLI flag wins, then session history, then the
// configured agent. fitVariant() drops unsupported session/config values.
export function resolveVariant(
  input: string | undefined,
  session: string | undefined,
  configured: string | undefined, // kilocode_change
  variants: string[],
): string | undefined {
  if (input !== undefined) {
    return input
  }

  const fallback = fitVariant(configured, variants) // kilocode_change
  const current = fitVariant(session, variants)
  if (current !== undefined) {
    return current
  }

  return fallback
}
