import type { AgentConfig } from "../../types/messages"

export function modelPatch(
  providerID: string,
  modelID: string,
  variants: string[],
  current?: string | null,
): Partial<AgentConfig> {
  if (!providerID || !modelID) {
    return { model: null, variant: null }
  }

  return {
    model: `${providerID}/${modelID}`,
    ...(current && !variants.includes(current) ? { variant: null } : {}),
  }
}
