// `kilo browser hub` (the browser or a CLI starts it) and `kilo browser install-host`.
import { Argument, Flag } from "effect/cli"
import { Spec } from "@opencode/cli/framework/spec"
import { DefaultPort } from "./protocol"

export const KiloBrowserCommands = Spec.make("browser", {
  description: "Browser bridge utilities",
  commands: [
    Spec.make("hub", {
      description: "Run the Kilo browser hub (the browser or the CLI starts it)",
      params: {
        native: Flag.Boolean("native").pipe(
          Flag.withDescription("Speak native messaging framing on stdio"),
          Flag.withDefault(false),
        ),
        loopback: Flag.Boolean("loopback").pipe(
          Flag.withDescription("Listen for the browser extension on a loopback WebSocket"),
          Flag.withDefault(false),
        ),
        port: Flag.Int("port").pipe(Flag.withDescription("Loopback WebSocket port"), Flag.withDefault(DefaultPort)),
        // Chrome passes the calling extension's origin as a positional argument and,
        // on Windows, its own window handle. The browser owns those arguments, so the
        // hub accepts them and validates the origin itself.
        "parent-window": Flag.String("parent-window").pipe(
          Flag.withDescription("Parent window handle the browser passes on Windows"),
          Flag.optional,
        ),
        args: Argument.String("args").pipe(
          Argument.variadic,
          Argument.withDescription("Caller identity arguments passed by the browser"),
        ),
      },
    }),
    Spec.make("install-host", {
      description: "Install the native messaging host for installed browsers",
    }),
  ],
})
