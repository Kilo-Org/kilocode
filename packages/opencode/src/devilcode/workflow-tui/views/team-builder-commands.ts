// packages/opencode/src/devilcode/workflow-tui/views/team-builder-commands.ts
import type { Command } from "@devilcode/keybind"
import type { useTeamBuilder } from "./team-builder-context"

/** Minimal registry surface needed to register commands. */
export type RegisterFn = (cmd: Command) => () => void

export type TeamBuilderCommandHandlers = {
  openBuilder(): void
}

/**
 * Register 4 team-builder commands using the provided register function.
 * Returns a cleanup function that unregisters all 4 commands.
 *
 * Fields used: id, title, scope, aliases, hideKeywords, hidden, onSelect.
 * Fields NOT used: category (absent from CommandData schema).
 */
export function registerTeamBuilderCommands(
  register: RegisterFn,
  builder: ReturnType<typeof useTeamBuilder>,
  handlers: TeamBuilderCommandHandlers,
): () => void {
  const unregs: Array<() => void> = []

  unregs.push(
    register({
      id: "workflow.team.build",
      title: "Team: Open Builder",
      scope: "workflow",
      aliases: ["team build"],
      hideKeywords: [],
      hidden: false,
      onSelect: () => handlers.openBuilder(),
    }),
  )

  unregs.push(
    register({
      id: "workflow.team.save",
      title: "Team: Save",
      scope: "team-builder",
      aliases: ["team save"],
      hideKeywords: [],
      hidden: false,
      onSelect: () => void builder.save(),
    }),
  )

  unregs.push(
    register({
      id: "workflow.team.load-quickstart",
      title: "Team: Load Quickstart",
      scope: "team-builder",
      aliases: ["team load-quickstart"],
      hideKeywords: [],
      hidden: false,
      onSelect: () => builder.openQuickstart(),
    }),
  )

  unregs.push(
    register({
      id: "workflow.team.validate",
      title: "Team: Validate",
      scope: "team-builder",
      aliases: ["team validate"],
      hideKeywords: [],
      hidden: false,
      onSelect: () => void builder.validateAndStartBuild(async () => {}),
    }),
  )

  return () => {
    for (const unreg of unregs) {
      unreg()
    }
  }
}
