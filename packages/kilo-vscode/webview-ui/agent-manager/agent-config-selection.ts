import { parseModelString } from "../../src/shared/provider-model"
import { modeVariant } from "../src/context/session-variant-store"
import type { Config, ModelSelection } from "../src/types/messages"

type Exists = (sel: ModelSelection) => boolean
type Variants = (sel: ModelSelection | null) => string[]

export function promptVariant(value: string | undefined, variants: string[]) {
  if (value === "default") return value
  return value && variants.includes(value) ? value : undefined
}

export function agentConfigModel(input: {
  config: Config
  agent: string
  fallback: ModelSelection | null
  exists: Exists
}) {
  const configured = parseModelString(input.config.agent?.[input.agent]?.model)
  if (configured && input.exists(configured)) return configured
  const global = parseModelString(input.config.model)
  if (global && input.exists(global)) return global
  return input.fallback
}

export function agentConfigVariant(input: {
  config: Config
  agent: string
  model: ModelSelection | null
  variants: string[]
}) {
  if (!input.model) return undefined
  const entry = input.config.agent?.[input.agent]
  const value = modeVariant(input.model, parseModelString(entry?.model), entry?.variant)
  if (!value || value === "default") return undefined
  return input.variants.includes(value) ? value : undefined
}

export function agentConfigSelection(input: {
  config: Config
  agent: string
  fallback: ModelSelection | null
  exists: Exists
  variants: Variants
}) {
  const model = agentConfigModel(input)
  return {
    model,
    variant: agentConfigVariant({
      config: input.config,
      agent: input.agent,
      model,
      variants: input.variants(model),
    }),
  }
}
