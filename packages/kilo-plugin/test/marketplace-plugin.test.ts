import { expect } from "bun:test"
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
const decode = Schema.decodeUnknownSync(KiloMarketplaceRpc.Installed)

it.live("persists new and pending ownership before cleanup, retains failures, and retries durable cleanup", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-")))
    yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))
    const archive = yield* Effect.promise(() => new Bun.Archive({ "SKILL.md": "new guide" }).bytes())
    using server = Bun.serve({
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/guide.tar"
          ? new Response(archive)
          : new Response(`items:
  - id: demo
    content: '{"url":"https://new.example.com/mcp"}'
    skills:
      - id: guide
        content: ${new URL("/guide.tar", request.url).href}
`),
    })
    yield* withEnv({ KILO_API_URL: server.url.origin }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const host = yield* PluginHost.make(plugin)
        const rpc = yield* Rpc.Service
        const old = path.join(directory, "old.json")
        const unreadable = path.join(directory, "not-a-file.json")
        const obsolete = path.join(directory, "skills", "obsolete")
        const guide = path.join(directory, "skills", "guide")
        const config = path.join(directory, "kilo2.json")
        yield* Effect.promise(async () => {
          await Bun.write(old, "{ broken")
          await fs.mkdir(unreadable)
          await fs.mkdir(obsolete, { recursive: true })
          await Bun.write(path.join(obsolete, "SKILL.md"), "obsolete guide")
        })
        const input = { registry: "kilo", kind: "mcp", id: "demo", scope: "global" } as const
        const key = "installed:kilo:mcp:demo:global:"
        yield* host.storage.set(
          key,
          JSON.stringify({
            ...input,
            installedAt: 0,
            paths: [obsolete],
            config: old,
            pending: [{ config: unreadable, server: "legacy" }],
          }),
        )
        const snapshots: KiloMarketplaceRpc.Installed[] = []
        let rejectWrite = Infinity
        yield* KiloMarketplacePlugin.effect({
          ...host,
          storage: {
            ...host.storage,
            set: (key, value) =>
              Effect.gen(function* () {
                if (key.startsWith("installed:")) {
                  const record = decode(JSON.parse(String(value)))
                  if (snapshots.length === 0) {
                    // The initial manifest owns everything while both old and new resources still exist.
                    expect(record).toMatchObject({
                      config,
                      paths: [guide],
                      pending: [
                        { config: unreadable, server: "legacy" },
                        { path: obsolete },
                        { config: old, server: "demo" },
                      ],
                    })
                    expect(yield* Effect.promise(() => Bun.file(path.join(obsolete, "SKILL.md")).exists())).toBe(true)
                    expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).text())).toBe("new guide")
                    expect(yield* Effect.promise(() => Bun.file(config).exists())).toBe(true)
                  }
                  snapshots.push(record)
                  if (snapshots.length === rejectWrite) return yield* Effect.die(new Error("progress write failed"))
                }
                yield* host.storage.set(key, value)
              }),
          },
        }).pipe(Effect.provide(Global.layerWith({ config: directory })))

        const first = decode(yield* rpc.call("kilocode.marketplace", "install", input))
        expect(first.pending).toEqual([
          { config: unreadable, server: "legacy" },
          { config: old, server: "demo" },
        ])
        expect(snapshots).toHaveLength(2)
        expect(decode(JSON.parse(String(yield* host.storage.get(key))))).toEqual(first)
        expect(yield* Effect.promise(() => fs.readdir(path.join(directory, "skills")))).toEqual(["guide"])

        // Uninstall may remove active resources, but a failed pending read must keep the manifest for retry.
        expect(yield* rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
          type: "write_failed",
        })
        expect(decode(JSON.parse(String(yield* host.storage.get(key))))).toEqual(first)
        const again = decode(yield* rpc.call("kilocode.marketplace", "install", input))
        expect(again.pending).toEqual(first.pending)
        expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).text())).toBe("new guide")

        yield* Effect.promise(async () => {
          await fs.rmdir(unreadable)
          await Bun.write(
            unreadable,
            JSON.stringify({ mcp: { servers: { legacy: { type: "remote", url: "https://legacy" } } } }),
          )
          await Bun.write(old, JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://old" } } } }))
        })
        // A failed progress save must not reject a successful install or forget the durable cleanup list.
        rejectWrite = snapshots.length + 2
        const unsaved = decode(yield* rpc.call("kilocode.marketplace", "install", input))
        expect(unsaved.pending).toEqual(first.pending)
        expect(decode(JSON.parse(String(yield* host.storage.get(key))))).toEqual(unsaved)
        const finished = decode(yield* rpc.call("kilocode.marketplace", "install", input))
        expect(finished.pending).toBeUndefined()
        expect(decode(JSON.parse(String(yield* host.storage.get(key))))).toEqual(finished)
        expect(yield* Effect.promise(() => Bun.file(old).json())).toEqual({ mcp: { servers: {} } })
        expect(yield* Effect.promise(() => Bun.file(unreadable).json())).toEqual({ mcp: { servers: {} } })
        yield* rpc.call("kilocode.marketplace", "uninstall", input)
        expect(yield* host.storage.get(key)).toBeUndefined()
        expect(yield* Effect.promise(() => fs.readdir(path.join(directory, "skills")))).toEqual([])
      }),
    )
  }),
)
