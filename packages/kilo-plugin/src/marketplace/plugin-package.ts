import { Host } from "@opencode/plugin/host"
import { Npm } from "@opencode/util/npm"
import { Effect } from "effect"
import { PluginGitSource } from "../plugin/git-source"

/**
 * A package that cannot become an active plugin: an unparsable or uninstallable target, a package with no server
 * or GUI entrypoint, or a failed clone or install.
 */
export class PluginPackageError extends Error {
  constructor(
    readonly reason: "invalid_params" | "fetch_failed",
    message: string,
  ) {
    super(message)
  }
}

/**
 * Resolve and install a catalog plugin spec through the same package machinery the plugin loader uses, so an
 * install fails before it writes config instead of leaving an entry the loader cannot activate. `npm` is passed in
 * so the resolver stays testable without a package manager.
 *
 * A package must expose a server or GUI entrypoint, which is what `PluginModule.load` requires. v1 could install a
 * TUI-only package because it kept a separate TUI plugin list, but v2 has one native config shared by the server
 * and the TUI, so a TUI-only package in it would make the server report a failed plugin for every location.
 */
export function resolve(input: {
  spec: string
  npm: Npm.Interface
}): Effect.Effect<{ directory: string }, PluginPackageError> {
  return Effect.gen(function* () {
    if (PluginGitSource.isGitPluginSpec(input.spec)) {
      const target = yield* Effect.tryPromise({
        try: () => PluginGitSource.resolveGitPluginTarget(input.spec),
        catch: (error) => new PluginPackageError("fetch_failed", message(error)),
      })
      if (!target.ok)
        return yield* Effect.fail(
          new PluginPackageError(
            target.code === "clone_failed" || target.code === "not_cached" ? "fetch_failed" : "invalid_params",
            message(target.error),
          ),
        )
      return yield* entrypoints({ directory: target.target }, input.spec)
    }
    const installable = yield* Effect.promise(() => Npm.isInstallablePackage(input.spec))
    if (!installable)
      return yield* Effect.fail(
        new PluginPackageError(
          "invalid_params",
          "Plugin target must be an npm registry package or Git package specifier",
        ),
      )
    const installed = yield* input.npm
      .add(input.spec)
      .pipe(Effect.mapError((error) => new PluginPackageError("fetch_failed", message(error))))
    return yield* entrypoints(installed, input.spec)
  })
}

function entrypoints(target: Host.Target, spec: string) {
  const entry = Effect.try({
    try: () => Host.resolve(target),
    catch: (error) => new PluginPackageError("fetch_failed", message(error)),
  })
  return Effect.flatMap(entry, (resolved) =>
    resolved.server || resolved.gui
      ? Effect.succeed({ directory: target.directory })
      : Effect.fail(
          new PluginPackageError("invalid_params", `Plugin package has no server or GUI entrypoint: ${spec}`),
        ),
  )
}

function message(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message
  return String(error)
}
