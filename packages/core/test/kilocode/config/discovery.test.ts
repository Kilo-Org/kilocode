import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { emptyCredentialNode, emptyWellknownNode } from "../../fixture/config-nodes"
import { location } from "../../fixture/location"
import { tmpdirScoped } from "../../fixture/tmpdir"
import { it } from "../../lib/effect"

// The Config graph with the replacement the Kilo host passes to every server (KiloHost.overrides). Without it,
// Config keeps the upstream names, which the upstream tests in test/config cover.
function configLayer(input: { directory: string; global: string; project?: string; git?: boolean }) {
  const project = AbsolutePath.make(input.project ?? input.directory)
  const vcs = input.git ? { type: "git" as const, store: AbsolutePath.make(path.join(project, ".git")) } : undefined
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    ConfigDiscovery.node.replace(Layer.succeed(ConfigDiscovery.LayoutService, KiloConfigDiscovery.layout)),
    Location.node.replace(
      Layer.succeed(
        Location.Service,
        Location.Service.of(
          location({ directory: AbsolutePath.make(input.directory) }, { projectDirectory: project, vcs }),
        ),
      ),
    ),
    Global.node.replace(Global.layerWith({ config: input.global, home: path.join(input.global, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  // Merge the watcher layer by reference so Watcher.Test resolves to the instance the built graph uses.
  return Layer.mergeAll(built, Watcher.testLayer)
}

const write = (file: string, value: unknown) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(value))
  })

const shells = Effect.gen(function* () {
  const config = yield* Config.Service
  return (yield* config.entries()).flatMap((entry) =>
    entry.type === "document" && entry.info.shell ? [entry.info.shell] : [],
  )
})

const directories = (root: string) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    return (yield* config.entries()).flatMap((entry) =>
      entry.type === "directory" && entry.path.startsWith(root) ? [path.relative(root, entry.path)] : [],
    )
  })

describe("Kilo config discovery", () => {
  it.live("reads kilo.json and kilo.jsonc at each level, farthest first and .jsonc after .json", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const nested = path.join(project, "app")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(project, "kilo.jsonc"), { shell: "root-jsonc" })
      yield* write(path.join(nested, "kilo.jsonc"), { shell: "nested-jsonc" })
      yield* write(path.join(nested, "kilo.json"), { shell: "nested-json" })

      expect(yield* shells.pipe(Effect.provide(configLayer({ directory: nested, project, global, git: true })))).toEqual(
        ["root-jsonc", "nested-json", "nested-jsonc"],
      )
    }),
  )

  it.live("ignores opencode.json, opencode.jsonc, .opencode and .kilocode next to Kilo files", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(project, "kilo.json"), { shell: "kilo" })
      yield* write(path.join(project, "opencode.json"), { shell: "opencode-json" })
      yield* write(path.join(project, "opencode.jsonc"), { shell: "opencode-jsonc" })
      yield* write(path.join(project, ".opencode", "opencode.json"), { shell: "dot-opencode" })
      yield* write(path.join(project, ".kilocode", "kilo.json"), { shell: "dot-kilocode" })
      yield* write(path.join(global, "opencode.jsonc"), { shell: "global-opencode" })

      const layer = configLayer({ directory: project, global, git: true })
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual(["kilo"])
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global"])
    }),
  )

  it.live("reads the global directory and .kilo in their Kilo v1 file orders", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      for (const name of ["kilo.jsonc", "kilo.json"]) {
        yield* write(path.join(global, name), { shell: `global-${name}` })
        yield* write(path.join(project, ".kilo", name), { shell: `dir-${name}` })
      }

      const layer = configLayer({ directory: project, global, git: true })
      // The global directory and project roots let .jsonc win; .kilo lets .json win (v1 ALL_CONFIG_FILES).
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual([
        "global-kilo.json",
        "global-kilo.jsonc",
        "dir-kilo.jsonc",
        "dir-kilo.json",
      ])
      // Commands, agents, modes, skills and plugins load from every directory entry.
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global", path.join("repo", ".kilo")])
    }),
  )

  it.live("reads only the root files of the global directory, not .kilo inside it", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(global, "kilo.json"), { shell: "global-root" })
      yield* write(path.join(global, ".kilo", "kilo.json"), { shell: "global-dot-kilo" })
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))

      const layer = configLayer({ directory: project, global, git: true })
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual(["global-root"])
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global"])
    }),
  )

  it.live("watches the Kilo names and .kilo in each project directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))

      const subscriptions = yield* Effect.gen(function* () {
        const config = yield* Config.Service
        const watcher = yield* Watcher.Test
        yield* config.entries()
        return yield* watcher.subscriptions()
      }).pipe(Effect.provide(configLayer({ directory: project, global, git: true })))

      expect(subscriptions).toContainEqual({
        type: "entries",
        path: AbsolutePath.make(project),
        names: [".agents", ".claude", ".kilo", "kilo.json", "kilo.jsonc"],
      })
    }),
  )

  it.live("stops at the worktree root, also when the location is a symlinked spelling", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const link = path.join(tmp.path, "link")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(tmp.path, "kilo.json"), { shell: "outside" })
      yield* write(path.join(tmp.path, ".kilo", "kilo.json"), { shell: "outside-dot" })
      yield* write(path.join(project, "kilo.json"), { shell: "root" })
      yield* Effect.promise(() => fs.mkdir(path.join(project, "app"), { recursive: true }))
      yield* Effect.promise(() => fs.symlink(project, link, process.platform === "win32" ? "junction" : undefined))

      expect(
        yield* shells.pipe(
          Effect.provide(configLayer({ directory: path.join(project, "app"), project, global, git: true })),
        ),
      ).toEqual(["root"])
      expect(
        yield* shells.pipe(
          Effect.provide(configLayer({ directory: path.join(link, "app"), project, global, git: true })),
        ),
      ).toEqual(["root"])
      // Outside version control the walk still reaches the filesystem root, like Kilo v1.
      expect(yield* shells.pipe(Effect.provide(configLayer({ directory: path.join(project, "app"), global })))).toEqual(
        ["outside", "root", "outside-dot"],
      )
    }),
  )

  it.live("writes global config to kilo.jsonc, else an existing kilo.json, and never to opencode files", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const repo = path.join(tmp.path, "repo")
      yield* Effect.promise(() => fs.mkdir(repo, { recursive: true }))
      const update = Effect.gen(function* () {
        const config = yield* Config.Service
        yield* config.update!({ shell: "/bin/zsh" })
      }).pipe(Effect.provide(configLayer({ directory: repo, global })))
      const read = (name: string) => Effect.promise(() => Bun.file(path.join(global, name)).json())

      yield* write(path.join(global, "opencode.jsonc"), {})
      yield* update
      expect(yield* read("kilo.jsonc")).toEqual({ shell: "/bin/zsh" })
      expect(yield* read("opencode.jsonc")).toEqual({})

      yield* Effect.promise(() => fs.rm(path.join(global, "kilo.jsonc")))
      yield* write(path.join(global, "kilo.json"), {})
      yield* update
      expect(yield* read("kilo.json")).toEqual({ shell: "/bin/zsh" })
      expect((yield* Effect.promise(() => fs.readdir(global))).toSorted()).toEqual(["kilo.json", "opencode.jsonc"])

      // With both files, kilo.jsonc wins, like Kilo v1.
      yield* write(path.join(global, "kilo.jsonc"), {})
      yield* write(path.join(global, "kilo.json"), {})
      yield* update
      expect(yield* read("kilo.jsonc")).toEqual({ shell: "/bin/zsh" })
      expect(yield* read("kilo.json")).toEqual({})
    }),
  )
})
