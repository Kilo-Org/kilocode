import { Spec } from "@opencode/cli/framework/spec"
import { Flag } from "effect/cli"

// Kilo's commands in the upstream `service` group: the OS login unit that starts the background server (./login).
export const KiloServiceCommands = {
  install: Spec.make("install", {
    description: "Start the background server at login",
    params: {
      command: Flag.String("command").pipe(
        Flag.withDescription("Executable to start at login instead of this CLI"),
        Flag.optional,
      ),
    },
  }),
  uninstall: Spec.make("uninstall", { description: "Stop starting the background server at login" }),
}
