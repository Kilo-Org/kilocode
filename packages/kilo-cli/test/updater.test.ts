import { NodeFileSystem } from "@effect/platform-node"
import { Updater } from "@opencode/cli/services/updater"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloUpdater } from "../src/updater"
import { newer } from "../src/update-version"
import { packageName } from "../src/updater-install"

const current = "0.0.0-v2-99"
const next = "0.0.0-v2-100"
const platform = process.platform === "win32" ? "windows" : process.platform
const native = `${packageName}-${platform}-${process.arch}`

test("only newer preview builds are actionable, including reruns and digit changes", () => {
  expect(newer(next, current)).toBe(true)
  expect(newer(`${next}.2`, next)).toBe(true)
  expect(newer(next, `${next}.2`)).toBe(false)
  expect(newer(current, next)).toBe(false)
  expect(newer("7.8.27", next)).toBe(false)
  expect(newer("0.0.0-rc-101", next)).toBe(false)
})

test.each([
  ["@opencode/cli", next],
  [packageName, "7.8.27"],
])("rejects release metadata for %s at %s", async (name, version) => {
  await expect(
    KiloUpdater.resolveRelease(async (url, init) => {
      expect(url).toBe("https://registry.npmjs.org/%40kilocode%2Fcli/kilo-v2")
      expect(init.redirect).toBe("error")
      return Response.json({ name, version, optionalDependencies: { [native]: version } })
    }),
  ).rejects.toThrow("did not return a Kilo v2 release")
})

async function profile(
  options: {
    policy?: string
    status?: number
    channel?: string
    binaryVersion?: string
    ignoreScripts?: boolean
    reported?: string
    emptyTarball?: boolean
  } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-"))
  const manifest = path.join(root, "package.json")
  await Bun.write(manifest, JSON.stringify({ name: packageName, version: options.binaryVersion ?? current }))
  if (options.policy) await Bun.write(path.join(root, "kilo2.jsonc"), JSON.stringify({ update: options.policy }))
  const requests: string[] = []
  const installs: string[] = []
  const ownership = { active: true }
  const layers = LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, EffectFlock.node]), {
    replacements: [
      Global.node.replace(
        Global.layerWith({
          home: root,
          config: root,
          state: root,
          data: root,
          cache: root,
          log: root,
          repos: root,
          tmp: root,
          bin: root,
        }),
      ),
    ],
  })
  const layer = Layer.effect(
    Updater.Service,
    KiloUpdater.make(
      {
        channel: options.channel ?? "v2",
        version: current,
        executable: path.join(root, "kilo2.exe"),
        request: async (url) => {
          requests.push(url)
          if (url.endsWith(".tgz"))
            return new Response(options.emptyTarball ? "" : "x", { status: options.status ?? 206 })
          return Response.json({ name: packageName, version: next, optionalDependencies: { [native]: next } })
        },
      },
      () =>
        Effect.sync(() =>
          ownership.active
            ? {
                method: "npm",
                manifest,
                scriptsSetting: options.ignoreScripts ? [process.execPath, "-e", "console.log('true')"] : undefined,
                command: (version) => {
                  installs.push(version)
                  return [
                    process.execPath,
                    "-e",
                    "await Bun.write(process.argv[1], JSON.stringify({name:'@kilocode/cli',version:process.argv[2]}))",
                    manifest,
                    version,
                  ]
                },
              }
            : undefined,
        ),
      () => [process.execPath, "-e", "console.log(process.argv[1])", options.reported ?? `kilo2 v${next}`],
    ),
  )
  return {
    requests,
    installs,
    ownership,
    run: <A, E>(effect: Effect.Effect<A, E, Updater.Service>) =>
      Effect.runPromise(
        effect.pipe(Effect.provide(layer), Effect.provide(layers), Effect.provide(NodeFileSystem.layer)),
      ),
    installed: async () => (await Bun.file(manifest).json()).version as string,
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

test("default background check notifies; explicit apply installs the pinned build once", async () => {
  await using temp = await profile()
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect(yield* updater.run()).toEqual({ type: "available", version: next })
      expect(temp.installs).toEqual([])
      yield* updater.apply(next)
      expect(yield* updater.check()).toEqual({ type: "installed", version: next })
      yield* updater.apply(next)
    }),
  )
  expect(temp.installs).toEqual([next])
  expect(await temp.installed()).toBe(next)
  expect(temp.requests).toContain(`https://registry.npmjs.org/${native}/-/${native.split("/")[1]}-${next}.tgz`)
})

test("opted-in auto mode updates without restarting a server", async () => {
  await using temp = await profile({ policy: "auto" })
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      const announced: string[] = []
      expect(yield* updater.run((version) => announced.push(version))).toEqual({ type: "installed", version: next })
      expect(announced).toEqual([next])
    }),
  )
  expect(await temp.installed()).toBe(next)
})

test("a missing platform download or incorrect install method leaves the existing version alone", async () => {
  await using temp = await profile({ status: 404 })
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect((yield* updater.upgrade("curl", next).pipe(Effect.flip)).message).toContain("managed by npm")
      expect((yield* updater.apply("0.0.0-v2-101").pipe(Effect.flip)).message).toContain("tag changed")
      expect((yield* updater.apply(next).pipe(Effect.flip)).message).toContain("HTTP 404")
    }),
  )
  expect(temp.installs).toEqual([])
  expect(await temp.installed()).toBe(current)
})

test("does not replace a working launcher when the package manager disables postinstall", async () => {
  await using temp = await profile({ ignoreScripts: true })
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect((yield* updater.apply(next).pipe(Effect.flip)).message).toContain("must allow Kilo's postinstall")
    }),
  )
  expect(temp.installs).toEqual([])
  expect(await temp.installed()).toBe(current)
})

test("rechecks ownership before applying an earlier notification", async () => {
  await using temp = await profile()
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect(yield* updater.check()).toEqual({ type: "available", version: next })
      temp.ownership.active = false
      expect((yield* updater.apply(next).pipe(Effect.flip)).message).toContain("install changed")
    }),
  )
  expect(temp.installs).toEqual([])
  expect(await temp.installed()).toBe(current)
})

test("an updated manifest cannot disguise a stale executable", async () => {
  await using temp = await profile({ reported: `kilo2 v${current}` })
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect((yield* updater.apply(next).pipe(Effect.flip)).message).toContain("did not report version")
      expect((yield* updater.check().pipe(Effect.flip)).message).toContain("did not report version")
    }),
  )
})

test("a successful HTTP response with an empty platform tarball does not start an install", async () => {
  await using temp = await profile({ emptyTarball: true })
  await temp.run(
    Effect.gen(function* () {
      const updater = yield* Updater.Service
      expect((yield* updater.apply(next).pipe(Effect.flip)).message).toContain("empty tarball")
    }),
  )
  expect(temp.installs).toEqual([])
})

test.each([{ channel: "local" }, { binaryVersion: "7.8.27" }, { policy: "disable" }])(
  "skips automatic updates without querying npm for %j",
  async (options) => {
    await using temp = await profile(options)
    await temp.run(
      Effect.gen(function* () {
        const updater = yield* Updater.Service
        expect(yield* updater.run()).toBeUndefined()
        expect(yield* updater.method()).toBeUndefined()
        expect(updater.removal("npm")).toBeUndefined()
      }),
    )
    expect(temp.requests).toEqual([])
    expect(temp.installs).toEqual([])
  },
)
