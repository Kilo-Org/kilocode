import { Spec } from "@opencode/cli/framework/spec"
import { Flag } from "effect/cli"

export const ImportCommand = Spec.make("import", {
  description: "Import data from an earlier Kilo installation",
  commands: [
    Spec.make("v1", {
      description:
        "Import the Kilo v1 sessions into a new kilo2 session store. The v1 store is only read and stays as it is.",
      params: {
        from: Flag.String("from").pipe(
          Flag.withDescription(
            "Kilo v1 kilo.db file or its data directory (default: the kilo directory beside the kilo2 data directory)",
          ),
          Flag.optional,
        ),
        since: Flag.String("since").pipe(
          Flag.withDescription(
            "Import only the sessions updated since this time, plus their parent and child sessions: a duration such as 14d, 2w or 36h, or a date such as 2026-10-27 (default: the full store)",
          ),
          Flag.optional,
        ),
      },
    }),
  ],
})
