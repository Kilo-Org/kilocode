// kilocode_change - new file
import type { Agent } from "@/agent/agent"
import type { Command } from "@/command"

export function resolve(input: {
  command: Pick<Command.Info, "model" | "agent" | "variant">
  agent: Pick<Agent.Info, "model" | "variant">
  model: { providerID: string; modelID: string }
  selected: { variants?: Record<string, unknown> }
  input?: string
}) {
  if (input.command.variant && input.selected.variants?.[input.command.variant]) return input.command.variant

  if (
    input.agent.model &&
    input.agent.model.providerID === input.model.providerID &&
    input.agent.model.modelID === input.model.modelID &&
    input.agent.variant &&
    input.selected.variants?.[input.agent.variant]
  ) {
    return input.agent.variant
  }

  if (
    !input.command.model &&
    (!input.command.agent || !input.agent.model) &&
    input.input &&
    input.selected.variants?.[input.input]
  ) {
    return input.input
  }

  return undefined
}
