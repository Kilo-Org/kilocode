import { Directory } from "@/acp/directory"
import { resolveAgentVariant } from "@/kilocode/cli/cmd/tui/model-variant"

export function select(input: { snapshot: Directory.Snapshot; model: Directory.DefaultModel; modeId?: string }) {
  const variants = Directory.variants(input.snapshot, input.model)
  if (!variants) return

  const mode = input.modeId ? input.snapshot.availableModes.find((item) => item.id === input.modeId) : undefined
  const configured = mode
    ? resolveAgentVariant({
        current: input.model,
        config: mode.model,
        variant: mode.variant,
        variants,
      })
    : undefined
  if (configured) return configured
  if (variants.default) return "default"
  return Object.keys(variants)[0]
}
