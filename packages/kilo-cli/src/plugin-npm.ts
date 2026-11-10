export * as KiloPluginNpm from "./plugin-npm"

import { PluginGitSource } from "@kilocode/kilo-plugin/plugin/git-source"
import { Host } from "@opencode/plugin/host"
import { Npm } from "@opencode/util/npm"
import { Effect, Layer } from "effect"

/**
 * The npm service with Kilo `git:` plugin specs resolved from the plugin git cache. The server resolves a `git:`
 * target through the plugin loader's source hook, but a client resolves configured package targets through this
 * service on its own (the TUI's `packages.prepare`), and the plugin update check runs here too. Without the wrapper
 * those paths would send the same spec to npm and report a plugin the server loaded as failed. Every npm spec other
 * than a `git:` one, and every other method, reaches the native service unchanged.
 */
export const wrap = (npm: Npm.Interface): Npm.Interface => {
  // A git plugin's install and update are the same clone refresh; its update check has no registry to compare with.
  const git = (pkg: string) =>
    Effect.gen(function* () {
      const result = yield* Effect.promise(() => PluginGitSource.resolveGitPluginTarget(pkg))
      if (!result.ok)
        return yield* new Npm.InstallFailedError({
          add: [pkg],
          dir: PluginGitSource.cacheRoot(),
          cause: result.error,
        })
      return { directory: result.target, name: Host.packageID({ directory: result.target }) }
    })
  const owned = (pkg: string) => PluginGitSource.isGitPluginSpec(pkg)
  return {
    ...npm,
    add: (pkg) => (owned(pkg) ? git(pkg) : npm.add(pkg)),
    // `resolve` has no error channel: a git failure surfaces as a defect the caller's failure path records.
    resolve: (pkg) => (owned(pkg) ? git(pkg).pipe(Effect.orDie) : npm.resolve(pkg)),
    check: (pkg) => (owned(pkg) ? Effect.succeed(false) : npm.check(pkg)),
    update: (pkg) => (owned(pkg) ? git(pkg) : npm.update(pkg)),
  }
}

/** The host's npm node for the CLI and server graphs; replacing it keeps clients and the update check consistent. */
export const node = Npm.node.mapLayer((layer) =>
  Layer.effect(
    Npm.Service,
    Effect.map(Npm.Service, (npm) => wrap(npm)),
  ).pipe(Layer.provide(layer)),
)
