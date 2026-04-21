// packages/opencode/src/devilcode/workflow-tui/commands/team-swap.ts
// Phase 10 — /team swap <position> <provider> <model> command handler + registry binding.
import type { Command } from "@devilcode/keybind"
import { applyPositionSwap } from "../../team/position-swap"
import type { CanonicalTeamConfig } from "../../team/config"

type RegisterFn = (cmd: Command) => () => void

export type TeamSwapCommandHandlers = {
  getActiveTeam: () => CanonicalTeamConfig | undefined
  /** Called after a successful swap with the updated team config. Use to persist changes. */
  onSwapped: (config: CanonicalTeamConfig) => Promise<void>
  toast: {
    success: (msg: string) => void
    error: (msg: string) => void
    warning: (msg: string) => void
  }
}

export async function swapCommand(
  args: { position: string; provider: string; model: string },
  handlers: TeamSwapCommandHandlers,
): Promise<void> {
  const config = handlers.getActiveTeam()
  if (!config) {
    handlers.toast.warning("No active team config. Load a team before swapping positions.")
    return
  }

  // Clone to avoid mutating live config before confirming success
  const teamConfig: CanonicalTeamConfig = JSON.parse(JSON.stringify(config))
  const result = applyPositionSwap(teamConfig, {
    position: args.position,
    provider: args.provider,
    model: args.model,
  })

  if (result.success) {
    await handlers.onSwapped(teamConfig)
    handlers.toast.success(
      `Swapped ${result.position}: ${result.previousProvider}/${result.previousModel} → ${result.newProvider}/${result.newModel}`,
    )
  } else {
    handlers.toast.error(`Swap failed [${result.code}]: ${result.error}`)
  }
}

export function registerTeamSwapCommand(register: RegisterFn, handlers: TeamSwapCommandHandlers): () => void {
  return register({
    id: "workflow.team.swap",
    title: "Team: Swap Position",
    scope: "workflow",
    aliases: ["team swap"],
    hideKeywords: [],
    hidden: false,
    onSelect: () => {
      handlers.toast.warning("Type 'team swap <position> <provider> <model>' in the prompt to execute")
    },
  } as Command)
}
