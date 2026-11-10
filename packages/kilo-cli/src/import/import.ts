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
        status: Flag.Boolean("status").pipe(
          Flag.withDescription("Print the Kilo v1 and kilo2 session store state as JSON and exit, without importing."),
          Flag.withDefault(false),
        ),
      },
    }),
  ],
})
