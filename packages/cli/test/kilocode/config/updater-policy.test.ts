import { NodeServices } from "@effect/platform-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn } from "bun:test"
import { Effect, FileSystem, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import path from "node:path"
import { testEffect } from "../../../../core/test/lib/effect"
import { Updater } from "../../../src/services/updater"
import { isolatedEnv } from "../../fixture/environment"

declare const OPENCODE_CHANNEL: string | undefined

const it = testEffect(NodeServices.layer)

function fixture() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "kilo-updater-policy-" })
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const executable = path.join(
      global.home,
      ".opencode",
      "bin",
      process.platform === "win32" ? "opencode.exe" : "opencode",
    )
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    yield* fs.makeDirectory(global.config, { recursive: true })
    const requests: string[] = []
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (input: string | URL | Request) => {
              requests.push(input instanceof Request ? input.url : input.toString())
              return Response.json({ version: "1.0.1", metadata: { package: "@opencode/cli" } })
            },
            { preconnect: fetch.preconnect },
          ),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provide(
        LayerNode.compile(EffectFlock.node, {
          replacements: [Global.node.replace(Layer.succeed(Global.Service, global))],
        }),
      ),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        realPath: (input) => fs.realPath(input === process.execPath ? executable : input),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: () => Effect.die("Unexpected updater command"),
          runStream: () => Stream.die("Unexpected streaming updater command"),
        }),
      ),
    )
    return { updater, fs, config: global.config, requests }
  })
}

it.live("updater policy is tested in a release-build child", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "kilo-updater-child-" })
    const child = Bun.spawn(
      [
        process.execPath,
        "test",
        import.meta.path,
        "--define",
        'OPENCODE_CHANNEL="stable"',
        "--define",
        'OPENCODE_VERSION="1.0.0"',
        "--test-name-pattern",
        "^release updater policy: ",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../../.."),
        stdout: "ignore",
        stderr: "pipe",
        env: isolatedEnv(root, {
          // Bun can otherwise reuse modules compiled with local-build constants.
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          OPENCODE_DISABLE_AUTOUPDATE: "false",
        }),
      },
    )
    const [code, stderr] = yield* Effect.promise(() => Promise.all([child.exited, new Response(child.stderr).text()]))
    expect(code, stderr).toBe(0)
    expect(stderr).toContain("7 pass")
  }),
)

if (typeof OPENCODE_CHANNEL === "string" && OPENCODE_CHANNEL === "stable") {
  it.live("release updater policy: kilo2.json disables release requests", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.fs.writeFileString(path.join(test.config, "kilo2.json"), '{"autoupdate": false}')
      expect(yield* test.updater.run()).toBeUndefined()
      expect(test.requests).toEqual([])
    }),
  )

  it.live("release updater policy: kilo2.jsonc notify overrides kilo2.json disable", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.fs.writeFileString(path.join(test.config, "kilo2.json"), '{"autoupdate": false}')
      yield* test.fs.writeFileString(
        path.join(test.config, "kilo2.jsonc"),
        '{\n // Notify without installing.\n "update": "notify",\n}',
      )
      expect(yield* test.updater.run()).toEqual({ type: "available", version: "1.0.1" })
      expect(test.requests).toEqual(["https://opencode.ai/update/api/stable/cli/npm?current=1.0.0"])
    }),
  )
  ;["kilo.json", "kilo.jsonc", "config.json", "opencode.json", "opencode.jsonc"].forEach((name) => {
    it.live(`release updater policy: ignores legacy ${name}`, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        yield* test.fs.writeFileString(path.join(test.config, name), '{"update": "disable", "autoupdate": false}')
        expect(yield* test.updater.run()).toEqual({ type: "available", version: "1.0.1" })
        expect(test.requests).toEqual(["https://opencode.ai/update/api/stable/cli/npm?current=1.0.0"])
      }),
    )
  })
}
