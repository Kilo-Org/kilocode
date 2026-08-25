import { ConfigPlugin } from "@/config/plugin"
import { Npm } from "@opencode-ai/core/npm"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { Effect, Exit } from "effect"

export function needsLocalPluginDependency(plugins: readonly ConfigPluginV1.Spec[]) {
  return plugins.some((plugin) => ConfigPlugin.pluginSpecifier(plugin).startsWith("file://"))
}

export function installLocalPluginDependency(npm: Npm.Interface, dir: string, version: string, local: boolean) {
  return npm
    .install(dir, {
      add: [
        {
          name: "@kilocode/plugin",
          version: local ? undefined : version,
        },
      ],
    })
    .pipe(
      Effect.exit,
      Effect.tap((exit) =>
        Exit.isFailure(exit)
          ? Effect.logWarning("background dependency install failed", { dir, error: String(exit.cause) })
          : Effect.void,
      ),
      Effect.asVoid,
      Effect.forkDetach,
    )
}
