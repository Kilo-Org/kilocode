import { Spec } from "@opencode/cli/framework/spec"
import { Argument, Flag } from "effect/cli"

// `kilo auto`: custom auto routers (ADR 0005). Port of v1 packages/opencode/src/kilocode/cli/cmd/auto.ts (#15183).
// The commands are clients of the server: the `routers.*` methods of the `kilocode.gateway` RPC run the Cloud
// requests in the Gateway account scope of the server.
const ServerParams = {
  standalone: Flag.Boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
  server: Flag.String("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
}

const target = {
  router: Argument.String("router").pipe(Argument.withDescription("router id or slug")),
  model: Argument.String("model").pipe(Argument.withDescription("<provider>/<model> resolved by this CLI")),
}

export const AutoCommand = Spec.make("auto", {
  description: "custom auto routers: register client models and run client evals",
  commands: [
    Spec.make("router", {
      description: "manage custom auto router client entries",
      commands: [
        Spec.make("list", {
          description: "list custom auto routers, their entries, and per-entry eval status",
          params: {
            ...ServerParams,
            json: Flag.Boolean("json").pipe(
              Flag.withDescription("print the raw router list as JSON"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("add", {
          description: "register a client model as a custom auto router entry",
          params: { ...ServerParams, ...target },
        }),
        Spec.make("remove", {
          description: "remove a client model entry from a custom auto router",
          params: { ...ServerParams, ...target },
        }),
      ],
    }),
    Spec.make("eval", {
      description: "run the missing client evals for a custom auto router locally in Docker",
      params: {
        ...ServerParams,
        router: target.router,
        yes: Flag.Boolean("yes").pipe(Flag.withDescription("skip the plan confirmation"), Flag.withDefault(false)),
        concurrency: Flag.Int("concurrency").pipe(
          Flag.withDescription("number of cases to run in parallel"),
          Flag.withDefault(1),
        ),
        cliVersion: Flag.String("cli-version").pipe(
          Flag.withDescription(
            "published @kilocode/cli version to install in the eval image (default: this CLI's version)",
          ),
          Flag.optional,
        ),
        debugConfig: Flag.Boolean("debug-config").pipe(
          Flag.withDescription("print the Docker command and the generated container config, then exit"),
          Flag.withDefault(false),
        ),
      },
    }),
  ],
})
