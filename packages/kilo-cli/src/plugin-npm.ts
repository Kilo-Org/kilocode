export * as KiloPluginNpm from "./plugin-npm"

import { PluginGitSource } from "@kilocode/kilo-plugin/plugin/git-source"
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
  const directory = (pkg: string) => PluginGitSource.cacheDirectory(pkg) ?? pkg
  // A clone is a plain directory to the loader, and `Host.resolve` switches to package self-reference resolution as
  // soon as a name is supplied. Leaving the name empty makes it read the clone's own manifest, exactly like the
  // server's `{ directory: target }` path, so a plugin whose manifest maps no `exports` resolves the same way here.
  const packageOf = (target: string) => ({ directory: target, name: "" })
  // A git plugin's install and update are the same clone refresh; its update check has no registry to compare with.
  // A rejection is mapped to the typed failure so no caller sees a defect where it expects a plugin error.
  const git = (pkg: string, options: { readonly refresh: boolean; readonly force?: boolean }) =>
    Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: () => PluginGitSource.resolveGitPluginTarget(pkg, options),
        catch: (cause) => new Npm.InstallFailedError({ add: [pkg], dir: directory(pkg), cause }),
      })
      if (!result.ok)
        return yield* new Npm.InstallFailedError({ add: [pkg], dir: directory(pkg), cause: result.error })
      return packageOf(result.target)
    })
  // `resolve` is the non-installing read path the TUI and `plugin list` use: it reads the cache and reports the
  // expected directory when nothing is cached yet, like `Npm.resolve` does for a package that is not installed,
  // instead of cloning over the network or dying.
  const cached = (pkg: string) =>
    git(pkg, { refresh: false }).pipe(Effect.catch(() => Effect.succeed(packageOf(directory(pkg)))))
  const owned = (pkg: string) => PluginGitSource.isGitPluginSpec(pkg)
  return {
    ...npm,
    add: (pkg) => (owned(pkg) ? git(pkg, { refresh: true }) : npm.add(pkg)),
    resolve: (pkg) => (owned(pkg) ? cached(pkg) : npm.resolve(pkg)),
    check: (pkg) => (owned(pkg) ? Effect.succeed(false) : npm.check(pkg)),
    // An explicit update must fetch, even when the cached clone is still inside the refresh window.
    update: (pkg) => (owned(pkg) ? git(pkg, { refresh: true, force: true }) : npm.update(pkg)),
  }
}

/** The host's npm node for the CLI and server graphs; replacing it keeps clients and the update check consistent. */
export const node = Npm.node.mapLayer((layer) =>
  Layer.effect(
    Npm.Service,
    Effect.map(Npm.Service, (npm) => wrap(npm)),
  ).pipe(Layer.provide(layer)),
)
