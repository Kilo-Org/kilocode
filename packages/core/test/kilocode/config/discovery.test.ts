import path from "path"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Logger } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { AppProcess } from "@opencode/util/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { ChildProcess } from "effect/process"
import { emptyCredentialNode, emptyWellknownNode } from "../../fixture/config-nodes"
import { location } from "../../fixture/location"
import { withEnv } from "../../fixture/env"
import { tmpdirScoped } from "../../fixture/tmpdir"
import { it } from "../../lib/effect"

// The Config graph with the replacement the Kilo host passes to every server (KiloHost.overrides). Without it,
// Config keeps the upstream names, which the upstream tests in test/config cover.
function configLayer(input: {
  directory: string
  global: string
  project?: string
  git?: boolean
  options?: Config.Options
  overrides?: LayerNode.Replacements
}) {
  const project = AbsolutePath.make(input.project ?? input.directory)
  const vcs = input.git ? { type: "git" as const, store: AbsolutePath.make(path.join(project, ".git")) } : undefined
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false, ...input.options })),
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
    ...(input.overrides ?? []),
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
  test("uses Kilo's managed directory on each platform", () => {
    const system = KiloConfigDiscovery.layout.systemDirectory!
    expect(system("darwin", {})).toBe(AbsolutePath.make("/Library/Application Support/kilo"))
    expect(system("linux", {})).toBe(AbsolutePath.make("/etc/kilo"))
    expect(system("win32", { ProgramData: "D:\\ProgramData" })).toBe(AbsolutePath.make("D:\\ProgramData\\kilo"))
    expect(system("win32", { ProgramData: "D:/ProgramData/" })).toBe(AbsolutePath.make("D:\\ProgramData\\kilo"))
    expect(system("win32", {})).toBe(AbsolutePath.make("C:\\ProgramData\\kilo"))
    expect(ConfigDiscovery.systemDirectory("darwin", {})).toBe(
      AbsolutePath.make("/Library/Application Support/opencode"),
    )
    expect(ConfigDiscovery.systemDirectory("linux", { KILO_TEST_MANAGED_CONFIG_DIR: "/managed-test" })).toBe(
      AbsolutePath.make("/etc/opencode"),
    )
  })

  it.effect("the production layout ignores an ambient KILO_TEST_MANAGED_CONFIG_DIR", () =>
    withEnv({ KILO_TEST_MANAGED_CONFIG_DIR: "/managed-test", ProgramData: "D:\\ProgramData" }, () =>
      Effect.sync(() => {
        const system = KiloConfigDiscovery.layout.systemDirectory!
        expect(system("darwin", process.env)).toBe(AbsolutePath.make("/Library/Application Support/kilo"))
        expect(system("linux", process.env)).toBe(AbsolutePath.make("/etc/kilo"))
        expect(system("win32", process.env)).toBe(AbsolutePath.make("D:\\ProgramData\\kilo"))
      }),
    ),
  )

  it.live("managed files override user, explicit, project and runtime settings and retain Kilo policy fields", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      const managed = path.join(tmp.path, "managed")
      const explicit = path.join(tmp.path, "explicit.json")
      yield* write(path.join(global, "kilo2.jsonc"), { hide_prompt_training_models: false, shell: "user" })
      yield* write(explicit, { hide_prompt_training_models: false, shell: "explicit" })
      yield* write(path.join(project, ".kilo2", "kilo2.json"), { hide_prompt_training_models: false, shell: "project" })
      yield* write(path.join(managed, "kilo2.jsonc"), { hide_prompt_training_models: false, shell: "managed-jsonc" })
      yield* write(path.join(managed, "kilo2.json"), {
        hide_prompt_training_models: true,
        shell: "managed-json",
        policies: [{ effect: "deny", action: "tool.use", resource: "shell:*" }],
      })
      yield* write(path.join(managed, "kilo.json"), { hide_prompt_training_models: false, shell: "legacy-kilo" })
      yield* write(path.join(managed, "opencode.json"), { hide_prompt_training_models: false, shell: "opencode" })

      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(yield* shells).toEqual(["user", "explicit", "project", "runtime", "managed-jsonc", "managed-json"])
        expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: true })
        const entries = yield* config.entries()
        expect(entries.some((entry) => entry.type === "document" && entry.info.policies?.length)).toBe(true)
        const watcher = yield* Watcher.Test
        expect(yield* watcher.subscriptions()).toContainEqual(
          expect.objectContaining({ type: "directory", path: managed }),
        )
      }).pipe(
        Effect.provide(
          configLayer({
            directory: project,
            global,
            git: true,
            options: {
              system: managed,
              file: explicit,
              content: JSON.stringify({ hide_prompt_training_models: false, shell: "runtime" }),
            },
          }),
        ),
      )
      // Disabling managed discovery must leave the user/project policy effective.
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
      }).pipe(Effect.provide(configLayer({ directory: project, global, git: true })))
    }),
  )

  it.live(
    "warns about a malformed managed privacy flag without dropping permission policies or logging its value",
    () => {
      const messages: unknown[] = []
      const logger = Logger.map(Logger.formatStructured, (entry) => messages.push(entry.message))
      return Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const project = path.join(tmp.path, "repo")
        const global = path.join(tmp.path, "global")
        const managed = path.join(tmp.path, "managed")
        const file = path.join(managed, "kilo2.json")
        yield* write(path.join(project, "kilo2.json"), { hide_prompt_training_models: false })
        yield* write(file, {
          hide_prompt_training_models: "sensitive-invalid-value",
          policies: [{ effect: "deny", action: "tool.use", resource: "shell:*" }],
        })
        yield* Effect.gen(function* () {
          const config = yield* Config.Service
          const entries = yield* config.entries()
          expect(
            entries.flatMap((entry) =>
              entry.type === "document" && entry.path === file ? (entry.info.policies ?? []) : [],
            ),
          ).toEqual([{ effect: "deny", action: "tool.use", resource: "shell:*" }])
          expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
        }).pipe(Effect.provide(configLayer({ directory: project, global, options: { system: managed } })))
        expect(messages).toContainEqual([
          "configuration normalization diagnostic",
          expect.objectContaining({
            source: file,
            path: "$.hide_prompt_training_models",
            kind: "invalid",
            action: expect.stringContaining("expected a boolean"),
          }),
        ])
        expect(JSON.stringify(messages)).not.toContain("sensitive-invalid-value")
      }).pipe(Effect.provide(Logger.layer([logger])))
    },
  )

  const mac = process.platform === "darwin" ? it.live : it.live.skip
  mac("MDM preferences stay above the managed directory with an injected discovery layout", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      const managed = path.join(tmp.path, "managed")
      const plist = path.join(tmp.path, "managed.plist")
      yield* write(path.join(project, "kilo2.json"), { hide_prompt_training_models: false })
      yield* write(path.join(managed, "kilo2.json"), { hide_prompt_training_models: false, shell: "managed" })
      yield* Effect.promise(() =>
        fs.writeFile(
          plist,
          `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>hide_prompt_training_models</key><true/><key>shell</key><string>MDM</string>
<key>PayloadIdentifier</key><string>ai.opencode.managed</string></dict></plist>`,
        ),
      )
      const preferences = path.join("/Library/Managed Preferences", "ai.opencode.managed.plist")
      const files = FSUtil.node.mapLayer((layer) =>
        Layer.effect(
          FSUtil.Service,
          Effect.map(FSUtil.Service, (fs) => ({
            ...fs,
            isFile: (file: string) =>
              file.startsWith("/Library/Managed Preferences/") ? Effect.succeed(file === preferences) : fs.isFile(file),
          })),
        ).pipe(Layer.provide(layer)),
      )
      const processes = AppProcess.node.mapLayer((layer) =>
        Layer.effect(
          AppProcess.Service,
          Effect.map(AppProcess.Service, (process) => ({
            ...process,
            run: (command: ChildProcess.Command, options?: AppProcess.RunOptions) => {
              expect(command._tag).toBe("StandardCommand")
              if (command._tag !== "StandardCommand") return Effect.die("unexpected process")
              expect(command.command).toBe("plutil")
              expect(command.args).toEqual(["-convert", "json", "-o", "-", preferences])
              return process.run(ChildProcess.make("plutil", ["-convert", "json", "-o", "-", plist]), options)
            },
          })),
        ).pipe(Layer.provide(layer)),
      )
      yield* Effect.gen(function* () {
        const config = yield* Config.Service
        expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: true })
        expect(yield* shells).toEqual(["managed", "MDM"])
      }).pipe(
        Effect.provide(
          configLayer({
            directory: project,
            global,
            git: true,
            options: { system: true },
            overrides: [
              ConfigDiscovery.node.replace(
                Layer.succeed(ConfigDiscovery.LayoutService, {
                  ...KiloConfigDiscovery.layout,
                  systemDirectory: () => AbsolutePath.make(managed),
                }),
              ),
              FSUtil.node.replace(files),
              AppProcess.node.replace(processes),
            ],
          }),
        ),
      )
    }),
  )

  it.live("reads kilo2.json and kilo2.jsonc at each level, farthest first and .jsonc after .json", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const nested = path.join(project, "app")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(project, "kilo2.jsonc"), { shell: "root-jsonc" })
      yield* write(path.join(nested, "kilo2.jsonc"), { shell: "nested-jsonc" })
      yield* write(path.join(nested, "kilo2.json"), { shell: "nested-json" })

      expect(
        yield* shells.pipe(Effect.provide(configLayer({ directory: nested, project, global, git: true }))),
      ).toEqual(["root-jsonc", "nested-json", "nested-jsonc"])
    }),
  )

  it.live("ignores v1 Kilo and OpenCode config next to internal v2 files", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(project, "kilo2.json"), { shell: "kilo2" })
      yield* write(path.join(project, "kilo.json"), { shell: "v1-json" })
      yield* write(path.join(project, "kilo.jsonc"), { shell: "v1-jsonc" })
      yield* write(path.join(project, ".kilo", "kilo.json"), { shell: "v1-dir" })
      yield* write(path.join(project, ".kilo", "kilo2.json"), { shell: "v1-dir-v2-file" })
      yield* write(path.join(project, "opencode.json"), { shell: "opencode-json" })
      yield* write(path.join(project, "opencode.jsonc"), { shell: "opencode-jsonc" })
      yield* write(path.join(project, ".opencode", "opencode.json"), { shell: "dot-opencode" })
      yield* write(path.join(project, ".kilocode", "kilo.json"), { shell: "dot-kilocode" })
      yield* write(path.join(global, "opencode.jsonc"), { shell: "global-opencode" })
      yield* write(path.join(global, "kilo.json"), { shell: "global-v1-json" })
      yield* write(path.join(global, "kilo.jsonc"), { shell: "global-v1-jsonc" })

      const layer = configLayer({ directory: project, global, git: true })
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual(["kilo2"])
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global"])
    }),
  )

  it.live("reads the global directory and .kilo2 in their Kilo v1 file orders", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      for (const name of ["kilo2.jsonc", "kilo2.json"]) {
        yield* write(path.join(global, name), { shell: `global-${name}` })
        yield* write(path.join(project, ".kilo2", name), { shell: `dir-${name}` })
      }

      const layer = configLayer({ directory: project, global, git: true })
      // The global directory and project roots let .jsonc win; .kilo2 lets .json win (v1 file order).
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual([
        "global-kilo2.json",
        "global-kilo2.jsonc",
        "dir-kilo2.jsonc",
        "dir-kilo2.json",
      ])
      // Commands, agents, modes, skills and plugins load from every directory entry.
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global", path.join("repo", ".kilo2")])
    }),
  )

  it.live("reads only the root files of the global directory, not .kilo2 inside it", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(global, "kilo2.json"), { shell: "global-root" })
      yield* write(path.join(global, ".kilo2", "kilo2.json"), { shell: "global-dot-kilo2" })
      yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))

      const layer = configLayer({ directory: project, global, git: true })
      expect(yield* shells.pipe(Effect.provide(layer))).toEqual(["global-root"])
      expect(yield* directories(tmp.path).pipe(Effect.provide(layer))).toEqual(["global"])
    }),
  )

  it.live("watches the Kilo names and .kilo2 in each project directory", () =>
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
        names: [".agents", ".claude", ".kilo2", "kilo2.json", "kilo2.jsonc"],
      })
    }),
  )

  it.live("stops at the worktree root, also when the location is a symlinked spelling", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const project = path.join(tmp.path, "repo")
      const link = path.join(tmp.path, "link")
      const global = path.join(tmp.path, "global")
      yield* write(path.join(tmp.path, "kilo2.json"), { shell: "outside" })
      yield* write(path.join(tmp.path, ".kilo2", "kilo2.json"), { shell: "outside-dot" })
      yield* write(path.join(project, "kilo2.json"), { shell: "root" })
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

  it.live("writes global config to kilo2.jsonc, else an existing kilo2.json, and never to v1 or opencode files", () =>
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
      yield* write(path.join(global, "kilo.json"), {})
      yield* update
      expect(yield* read("kilo2.jsonc")).toEqual({ shell: "/bin/zsh" })
      expect(yield* read("opencode.jsonc")).toEqual({})
      expect(yield* read("kilo.json")).toEqual({})

      yield* Effect.promise(() => fs.rm(path.join(global, "kilo2.jsonc")))
      yield* write(path.join(global, "kilo2.json"), {})
      yield* update
      expect(yield* read("kilo2.json")).toEqual({ shell: "/bin/zsh" })
      expect((yield* Effect.promise(() => fs.readdir(global))).toSorted()).toEqual([
        "kilo.json",
        "kilo2.json",
        "opencode.jsonc",
      ])

      // With both files, .jsonc wins, like Kilo v1.
      yield* write(path.join(global, "kilo2.jsonc"), {})
      yield* write(path.join(global, "kilo2.json"), {})
      yield* update
      expect(yield* read("kilo2.jsonc")).toEqual({ shell: "/bin/zsh" })
      expect(yield* read("kilo2.json")).toEqual({})
    }),
  )
})
