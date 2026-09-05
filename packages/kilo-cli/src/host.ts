import { Config } from "@opencode-ai/core/config"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { ServerFetch } from "@opencode-ai/server/fetch"
import { Flock } from "@opencode-ai/util/flock"
import { Global } from "@opencode-ai/util/global"
import { Effect, References } from "effect"
import manifest from "../package.json"
import { identity, type Layout } from "./paths"
import { ProjectConfig } from "./project-config"

export function profile(input: Layout, options: { models?: boolean; content?: string; projectConfig?: boolean } = {}) {
  return {
    options: {
      app: { name: identity, version: manifest.version, channel: input.channel },
      database: { path: input.database },
      models: { fetch: options.models ?? false },
      events: { persist: input.channel === "interactive" },
      fs: { filewatcher: false, fff: false },
    },
    overrides: [
      Global.node.replace(Global.layerWith(input.paths)),
      Config.node.replace(
        ProjectConfig.configured({ enabled: options.projectConfig, file: input.config, content: options.content }),
      ),
      InstructionDiscovery.node.replace(
        InstructionDiscovery.configured({ global: false, project: input.channel === "interactive" }),
      ),
    ],
  }
}

export function open(input: Layout, password?: string) {
  return Effect.gen(function* () {
    Flock.setGlobal({ state: input.paths.state })
    const configured = profile(input)
    return yield* ServerFetch.make({ ...configured.options, password }, { overrides: configured.overrides })
  }).pipe(Effect.provideService(References.MinimumLogLevel, "Error"))
}
