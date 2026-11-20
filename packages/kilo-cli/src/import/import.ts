import { Spec } from "@opencode/cli/framework/spec"
import { Flag } from "effect/cli"

export const ImportCommand = Spec.make("import", {
  description: "Import data from an earlier Kilo installation",
  commands: [
    Spec.make("v1", {
      description:
        "Import the Kilo v1 sessions into the kilo session store. A new store gets the v1 store; an existing one gets the v1 sessions it does not have yet. The v1 store is only read and stays as it is.",
      params: {
        from: Flag.String("from").pipe(
          Flag.withDescription("Separate v1 database file or its data directory; use migrate for the active profile"),
        ),
        since: Flag.String("since").pipe(
          Flag.withDescription(
            "Import only the sessions updated since this time, plus their parent and child sessions: a duration such as 14d, 2w or 36h, or a date such as 2026-10-27 (default: the full store)",
          ),
          Flag.optional,
        ),
        config: Flag.Boolean("config").pipe(
          Flag.withDescription(
            "Also copy the Kilo v1 global config (kilo.json, skills, agents, commands, modes, rules, AGENTS.md) into the kilo config directory, without overwriting kilo files",
          ),
          Flag.withDefault(false),
        ),
      },
    }),
  ],
})
