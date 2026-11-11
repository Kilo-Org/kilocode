import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloMarketplacePlugin } from "../src/marketplace"

const it = testEffect(PluginTestLayer)

async function repository(files: Record<string, string>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-kind-")))
  await $`git init -q -b main`.cwd(dir).quiet()
  await $`git config user.email test@example.com`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(dir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, text)
  }
  await $`git add -A`.cwd(dir).quiet()
  await $`git commit -q -m commit`.cwd(dir).quiet()
  return dir
}

const manifest = JSON.stringify({ name: "kilo-plugin", exports: { "./server": "./server.js" } })

/** A registry serving one plugin item whose spec points at a local repository. */
const fixture = Effect.fn(function* (spec: (repo: string) => string = (repo) => `git:${repo}`) {
  const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-kind-")))
  const repo = yield* Effect.promise(() => repository({ "package.json": manifest, "server.js": "export default {}\n" }))
  yield* Effect.addFinalizer(() =>
    Effect.promise(() =>
      Promise.all([fs.rm(directory, { recursive: true, force: true }), fs.rm(repo, { recursive: true, force: true })]),
    ),
  )
  let served = spec(repo)
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (!url.pathname.endsWith("/plugins")) return new Response(Bun.YAML.stringify({ items: [] }))
      return new Response(
        Bun.YAML.stringify({
          items: [{ id: "kilo-plugin", name: "Kilo Plugin", description: "Demo", content: served }],
        }),
      )
    },
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  const rpc = yield* Rpc.Service
  return {
    directory,
    config: path.join(directory, "kilo2.json"),
    get spec() {
      return served
    },
    setSpec: (value: string) => {
      served = value
    },
    rpc,
    start: () =>
      withEnv({ KILO_API_URL: server.url.origin }, () =>
        KiloMarketplacePlugin.effect(host).pipe(Effect.provide(Global.layerWith({ config: directory }))),
      ),
  }
})

const json = (file: string) => Effect.promise(() => Bun.file(file).json() as Promise<unknown>)
const exists = (file: string) => Effect.promise(() => Bun.file(file).exists())

const request = { registry: "kilo", kind: "plugin", id: "kilo-plugin", scope: "global" } as const

describe("marketplace plugin kind", () => {
  it.live("lists, installs, reports and uninstalls a plugin", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      const listed = (yield* test.rpc.call("kilocode.marketplace", "list", { kind: "plugin" })) as {
        items: KiloMarketplaceRpc.Item[]
      }
      expect(listed.items).toMatchObject([{ id: "kilo-plugin", kind: "plugin", plugin: { spec: test.spec } }])
      // A plugin has no configuration to fill in, so it has no preview.
      expect(yield* test.rpc.call("kilocode.marketplace", "preview", request).pipe(Effect.flip)).toMatchObject({
        type: "invalid_params",
      })
      const record = (yield* test.rpc.call("kilocode.marketplace", "install", request)) as KiloMarketplaceRpc.Installed
      expect(record).toMatchObject({
        kind: "plugin",
        scope: "global",
        config: test.config,
        status: "ready",
        resources: [{ plugin: expect.stringContaining("git/") }],
      })
      expect(record.server).toBeUndefined()
      expect(yield* json(test.config)).toEqual({ plugins: [test.spec] })
      expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toMatchObject([
        { id: "kilo-plugin", status: "ready" },
      ])
      yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
      expect(yield* json(test.config)).toEqual({ plugins: [] })
      expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toEqual([])
    }),
  )
  it.live("replaces the owned entry when the catalog serves a new spec", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", request)
      const first = test.spec
      yield* Effect.promise(() => Bun.write(test.config, JSON.stringify({ plugins: [first], theme: "kilo" })))
      // A new ref is the same identity, so the entry is replaced in place and the rest of the file survives. A
      // fresh activation is used because the catalog list is cached per plugin effect.
      test.setSpec(`${first}@main`)
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", request)
      expect(yield* json(test.config)).toEqual({ plugins: [`${first}@main`], theme: "kilo" })
    }),
  )
  it.live("reads a hand-edited entry as modified and refuses reinstall and uninstall", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", request)
      // The owned entry keeps its identity but a user changed the ref, so its fingerprint no longer matches.
      yield* Effect.promise(() =>
        Bun.write(test.config, JSON.stringify({ plugins: [`${test.spec}@main`, { package: "hand-edited" }] })),
      )
      const installed = (yield* test.rpc.call(
        "kilocode.marketplace",
        "installed",
        {},
      )) as KiloMarketplaceRpc.Installed[]
      expect(installed).toMatchObject([{ status: "modified" }])
      expect(installed[0].warnings?.join(" ")).toContain("modified")
      expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", request).pipe(Effect.flip)).toMatchObject({
        type: "conflict",
      })
      expect(yield* test.rpc.call("kilocode.marketplace", "install", request).pipe(Effect.flip)).toMatchObject({
        type: "conflict",
      })
      expect(yield* json(test.config)).toEqual({ plugins: [`${test.spec}@main`, { package: "hand-edited" }] })
    }),
  )
  it.live("rejects a package the loader could not activate without writing config", () =>
    Effect.gen(function* () {
      const test = yield* fixture((repo) => `git:${repo}#missing-directory`)
      yield* test.start()
      expect(yield* test.rpc.call("kilocode.marketplace", "install", request).pipe(Effect.flip)).toMatchObject({
        type: "invalid_params",
      })
      expect(yield* exists(test.config)).toBe(false)
      expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toEqual([])
    }),
  )
  it.live("keeps ownership when the entry moves to another config file", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", request)
      const moved = path.join(test.directory, "kilo2.jsonc")
      yield* Effect.promise(async () => {
        await Bun.write(moved, JSON.stringify({ plugins: [test.spec] }))
        await fs.rm(test.config)
      })
      expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toMatchObject([{ status: "ready" }])
      yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
      expect(yield* json(moved)).toEqual({ plugins: [] })
    }),
  )
  // The kind is a wire contract shared by the server, the TUI and VS Code, so decode it instead of comparing a
  // copy of the literal list.
  test("the plugin kind, item content and owned resource decode", () => {
    const item = Schema.decodeUnknownSync(KiloMarketplaceRpc.Item)({
      registry: "kilo",
      kind: "plugin",
      id: "kilo-plugin",
      name: "Kilo Plugin",
      description: "Demo",
      tags: [],
      prerequisites: [],
      parameters: [],
      options: [],
      plugin: { spec: "kilo-plugin@1.2.3" },
    })
    expect(item.kind).toBe("plugin")
    expect(item.plugin).toEqual({ spec: "kilo-plugin@1.2.3" })
    expect(item.agent).toBeUndefined()
    const resource = Schema.decodeUnknownSync(KiloMarketplaceRpc.Resource)({
      plugin: "kilo-plugin",
      fingerprints: ["hash"],
    })
    expect(resource).toEqual({ plugin: "kilo-plugin", fingerprints: ["hash"] })
    const record = Schema.decodeUnknownSync(KiloMarketplaceRpc.Installed)({
      registry: "kilo",
      kind: "plugin",
      id: "kilo-plugin",
      scope: "project",
      installedAt: 0,
      config: ".kilo2/kilo2.json",
      resources: [resource],
    })
    expect(record).toMatchObject({ kind: "plugin", config: ".kilo2/kilo2.json", resources: [resource] })
    expect(record.server).toBeUndefined()
  })
})
