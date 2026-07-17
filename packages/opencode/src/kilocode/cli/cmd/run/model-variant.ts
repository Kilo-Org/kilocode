import type { RunAgent, RunInput } from "@/cli/cmd/run/types"

type Agent = Pick<RunAgent, "name" | "model" | "variant">

export function resolveConfiguredVariant(input: {
  agents: Agent[]
  agent: string | undefined
  model: RunInput["model"]
  variants: string[]
}) {
  const agent = input.agent ? input.agents.find((item) => item.name === input.agent) : input.agents[0]
  if (!agent || !input.model) return { agent: agent?.name, variant: undefined }

  const same =
    !agent.model || (agent.model.providerID === input.model.providerID && agent.model.modelID === input.model.modelID)
  const variant =
    same && (agent.variant === "default" || input.variants.includes(agent.variant ?? "")) ? agent.variant : undefined
  return { agent: agent.name, variant }
}

export function createVariantSelection(agent: string, variant: string | undefined) {
  const prompt = variant ?? "default"
  return {
    display: variant,
    prompt,
    config: {
      agent: {
        [agent]: {
          variant: prompt,
        },
      },
    },
  }
}

export type VariantConfig = ReturnType<typeof createVariantSelection>["config"]

export async function saveVariantConfig(input: {
  agent: string
  variant: string | undefined
  update: (config: VariantConfig) => Promise<unknown>
}) {
  const selection = createVariantSelection(input.agent, input.variant)
  const saved = await input.update(selection.config).then(
    () => true,
    () => false,
  )
  return saved ? selection : undefined
}
