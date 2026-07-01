type Variants = Record<string, unknown> | undefined

type Model = {
  providerID: string
  modelID: string
}

export function resolveConfiguredVariant(input: { variant: string | undefined; variants?: Variants }) {
  if (!input.variant) return undefined
  if (input.variant === "default") return undefined
  if (!input.variants?.[input.variant]) return undefined
  return input.variant
}

export function resolveAgentVariant(input: {
  current: Model
  config?: Model
  variant: string | undefined
  variants?: Variants
}) {
  const same =
    !input.config ||
    (input.config.providerID === input.current.providerID && input.config.modelID === input.current.modelID)
  if (!same) return undefined
  return resolveConfiguredVariant({ variant: input.variant, variants: input.variants })
}

export function resolvePromptVariant(input: {
  override: string | undefined
  current: Model
  config?: Model
  variant: string | undefined
  variants?: Variants
}) {
  if (input.override === "default") return "default"
  return input.override ?? resolveAgentVariant(input)
}

export function resolveRuntimeVariant(variant: string | undefined) {
  if (variant === "default") return undefined
  return variant
}

export function resolveSelectedVariant(input: { override?: string; config?: string; variants?: Variants }) {
  if (input.override === "default") return "default"
  const override = resolveConfiguredVariant({ variant: input.override, variants: input.variants })
  if (override) return override
  if (input.config === "default") return "default"
  return resolveConfiguredVariant({ variant: input.config, variants: input.variants })
}
