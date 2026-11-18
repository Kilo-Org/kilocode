import { expect } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect, Layer } from "effect"
import type { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { PluginModule } from "@opencode/core/plugin/module"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Npm } from "@opencode/util/npm"
import { Global } from "@opencode/util/global"
import { tempGlobalLayer } from "../fixture/global"
import { setOrganizationPolicy } from "../fixture/policy"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const plugin = JSON.stringify({ name: "seam-plugin", exports: { "./server": "./server.js" } })
const source = "export default { id: 'seam-plugin', effect: () => Effect.void }\n"

const it = testEffect(
  Layer.mergeAll(
    PluginTestLayer,
    AppNodeBuilder.build(Npm.node, [Global.node.replace(tempGlobalLayer)]),
    Watcher.layer().pipe(Layer.provide(Watcher.nativeLayer)),
  ),
)

const operation = (target: string): Extract<ConfigPluginSource.Operation, { type: "add" }> => ({
  type: "add",
  target,
  options: {},
})

// A `git:`-shaped target the loader cannot resolve on its own, with a fake host resolver: the seam is generic, and
// the Kilo resolver is covered end to end in packages/kilo-cli/test/plugin-git-source.test.ts.
const modules = (pluginSource: PluginModule.Options["pluginSource"]) =>
  PluginModule.make().pipe(
    Effect.provideService(PluginModule.OptionsService, PluginModule.OptionsService.of({ pluginSource })),
  )

it.live("loads a host-resolved target from the directory the hook returns", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const pluginDirectory = path.join(directory.path, "clone")
    yield* Effect.promise(() => Bun.write(path.join(directory.path, "package.json"), plugin))
    yield* Effect.promise(async () => {
      await mkdir(pluginDirectory, { recursive: true })
      await Bun.write(path.join(pluginDirectory, "package.json"), plugin)
      await Bun.write(path.join(pluginDirectory, "server.js"), source)
    })
    const loaded = yield* (yield* modules(() => Effect.succeed({ target: pluginDirectory }))).load(
      operation("git:/host/plugin"),
    )
    expect(loaded).toMatchObject({ id: "seam-plugin" })
  }),
)

it.live("defers a target the hook cannot resolve yet to the installing pass", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const pluginDirectory = path.join(directory.path, "clone")
    yield* Effect.promise(async () => {
      await mkdir(pluginDirectory, { recursive: true })
      await Bun.write(path.join(pluginDirectory, "package.json"), plugin)
      await Bun.write(path.join(pluginDirectory, "server.js"), source)
    })
    const hook = (_target: string, options: { readonly install: boolean }) =>
      Effect.succeed(options.install ? { target: pluginDirectory } : { pending: true as const })
    const loader = yield* modules(hook)

    expect(yield* loader.load(operation("git:/host/plugin"), { install: false })).toEqual({ pending: true })
    expect(yield* loader.load(operation("git:/host/plugin"), { install: true })).toMatchObject({ id: "seam-plugin" })
  }),
)

it.live("blocks a host-resolved target when a policy resource it names is denied", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const pluginDirectory = path.join(directory.path, "clone")
    yield* Effect.promise(async () => {
      await mkdir(pluginDirectory, { recursive: true })
      await Bun.write(path.join(pluginDirectory, "package.json"), plugin)
      await Bun.write(path.join(pluginDirectory, "server.js"), source)
    })
    yield* setOrganizationPolicy([{ action: "plugin.use", resource: "git/host/plugin", effect: "deny" }])
    const loader = yield* modules(() =>
      Effect.succeed({ target: pluginDirectory, resources: ["git/host/plugin"] }),
    )

    expect(yield* loader.load(operation("git:/host/plugin"))).toEqual({ blocked: true })
    // The configured spelling alone is allowed, so the denial above comes from the resolved resource.
    yield* setOrganizationPolicy([])
    expect(yield* loader.load(operation("git:/host/plugin"))).toMatchObject({ id: "seam-plugin" })
  }),
)

it.live("blocks a denied plugin before the installing pass reaches the resolver", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    yield* setOrganizationPolicy([{ action: "plugin.use", resource: "git/host/plugin", effect: "deny" }])
    const passes: boolean[] = []
    // The read pass names the resources from the spec alone, so the denial never needs a clone.
    const loader = yield* modules((_target, options) => {
      passes.push(options.install)
      return Effect.succeed(
        options.install
          ? { target: directory.path, resources: ["git/host/plugin"] }
          : { pending: true as const, resources: ["git/host/plugin"] },
      )
    })

    expect(yield* loader.load(operation("git:/host/plugin"), { install: true })).toEqual({ blocked: true })
    expect(passes).toEqual([false])
  }),
)

it.live("keeps the upstream behavior when no host resolver is configured", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    yield* Effect.promise(() => Bun.write(path.join(directory.path, "index.ts"), source))
    const loader = yield* PluginModule.make()
    expect(yield* loader.load(operation(directory.path))).toMatchObject({ id: "seam-plugin" })
  }),
)
