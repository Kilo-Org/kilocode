import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { Effect, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloMarketplacePlugin } from "../src/marketplace"
import { Installer } from "../src/marketplace/installer"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(KiloMarketplaceRpc.Installed)
const decodeList = Schema.decodeUnknownSync(Schema.Array(KiloMarketplaceRpc.Installed))
const input = { registry: "kilo", kind: "mcp", id: "demo", scope: "global" } as const
const key = "installed:kilo:mcp:demo:global:"

function journal(root: string) {
  const hash = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([input.registry, input.kind, input.id]))
    .digest("hex")
  return path.join(root, ".marketplace", "installed", `${hash}.json`)
}

const fixture = Effect.fn(function* () {
  const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))
  const archive = yield* Effect.promise(() => new Bun.Archive({ "SKILL.md": "new guide" }).bytes())
  let unavailable = false
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      unavailable
        ? new Response("Catalog temporarily unavailable", { status: 503 })
        : new URL(request.url).pathname === "/guide.tar"
          ? new Response(archive)
          : new Response(`items:
  - id: demo
    content: '{"url":"https://new.example.com/mcp"}'
    skills:
      - id: guide
        content: ${new URL("/guide.tar", request.url).href}
`),
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const rpc = yield* Rpc.Service
  return {
    directory,
    host,
    rpc,
    failCatalog: () => {
      unavailable = true
    },
    start: (context = host) =>
      withEnv({ KILO_API_URL: server.url.origin }, () =>
        KiloMarketplacePlugin.effect(context).pipe(Effect.provide(Global.layerWith({ config: directory }))),
      ),
  }
})

for (const cached of ["memory", "persisted"] as const) {
  it.live(`reports a failed source while serving its ${cached} catalog snapshot`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      expect(yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp" })).toMatchObject({
        items: [{ id: "demo" }],
        failures: [],
      })
      test.failCatalog()
      if (cached === "persisted") yield* test.start()
      expect(yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp", refresh: true })).toMatchObject({
        items: [{ id: "demo" }],
        failures: [{ registry: "kilo", message: expect.stringContaining("503") }],
      })
    }),
  )
}

it.live("a catalog cache write defect does not discard a successful registry response", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* test.start({
      ...test.host,
      storage: {
        ...test.host.storage,
        set: (storedKey, value) =>
          storedKey.startsWith("catalog:")
            ? Effect.die(new Error("cache write failed"))
            : test.host.storage.set(storedKey, value),
      },
    })
    expect(yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp" })).toMatchObject({
      items: [{ id: "demo" }],
      failures: [],
    })
  }),
)

it.live("persists beforeWrite intent in KV and the scope-local journal before any target mutation", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const snapshots: KiloMarketplaceRpc.Installed[] = []
    yield* test.start({
      ...test.host,
      storage: {
        ...test.host.storage,
        set: (storedKey, value) =>
          Effect.gen(function* () {
            yield* test.host.storage.set(storedKey, value)
            if (!storedKey.startsWith("installed:")) return
            const record = decode(JSON.parse(String(yield* test.host.storage.get(storedKey))))
            const local = yield* Effect.promise(() => Bun.file(journal(test.directory)).json())
            expect(local).toEqual({ directory: test.directory, record })
            if (snapshots.length === 0) {
              expect(record.recovering).toBe(true)
              expect(record.resources).toHaveLength(2)
              expect(record.resources?.every((resource) => resource.fingerprints?.length === 1)).toBe(true)
              expect(
                yield* Effect.promise(() =>
                  Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists(),
                ),
              ).toBe(false)
              expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).exists())).toBe(
                false,
              )
            }
            snapshots.push(record)
          }),
      },
    })
    const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].recovering).toBeUndefined()
    expect(installed.status).toBe("ready")
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).text())).toBe(
      "new guide",
    )
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toEqual(snapshots[1])
  }),
)

for (const fault of ["registries read", "registries set", "installed scan", "installation read"] as const) {
  it.live(`converts ${fault} storage defects into a declared RPC error`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start({
        ...test.host,
        storage: {
          ...test.host.storage,
          get: (storedKey) =>
            (fault === "registries read" && storedKey === "registries") ||
            (fault === "installation read" && storedKey === key)
              ? Effect.die(new Error(`injected ${fault}`))
              : test.host.storage.get(storedKey),
          set: (storedKey, value) =>
            fault === "registries set" && storedKey === "registries"
              ? Effect.die(new Error(`injected ${fault}`))
              : test.host.storage.set(storedKey, value),
          scan: (options) =>
            fault === "installed scan" ? Effect.die(new Error(`injected ${fault}`)) : test.host.storage.scan(options),
        },
      })
      const failure = yield* (
        fault === "registries read"
          ? test.rpc.call("kilocode.marketplace", "registries", {})
          : fault === "registries set"
            ? test.rpc.call("kilocode.marketplace", "registries.set", { id: "skills.sh", enabled: true })
            : fault === "installed scan"
              ? test.rpc.call("kilocode.marketplace", "installed", {})
              : test.rpc.call("kilocode.marketplace", "uninstall", input)
      ).pipe(Effect.flip)
      expect(failure).toMatchObject({ type: fault === "registries set" ? "write_failed" : "fetch_failed" })
      expect(JSON.stringify(failure)).toContain(`injected ${fault}`)
    }),
  )
}

for (const source of ["database", "local journal"] as const) {
  it.live(`rejects an invalid ${source} record rather than silently treating it as missing`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", input)
      if (source === "database") yield* test.host.storage.set(key, "{ broken")
      if (source === "local journal")
        yield* Effect.promise(() => Bun.write(journal(test.directory), '{"directory":"invalid","record":{}}'))
      for (const method of ["installed", "uninstall"] as const) {
        const failure = yield* test.rpc
          .call("kilocode.marketplace", method, method === "installed" ? {} : input)
          .pipe(Effect.flip)
        expect(failure).toMatchObject({ type: "fetch_failed" })
        expect(JSON.stringify(failure)).toContain("Invalid marketplace")
      }
      expect(
        yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).text()),
      ).toBe("new guide")
      expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).json())).toMatchObject({
        mcp: { servers: { demo: { url: "https://new.example.com/mcp" } } },
      })
    }),
  )
}

for (const resource of ["skill", "mcp"] as const) {
  it.live(`reports a missing ${resource} and repairs it without losing the installation`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", input)
      yield* Effect.promise(() =>
        fs.rm(
          resource === "skill" ? path.join(test.directory, "skills", "guide") : path.join(test.directory, "kilo2.json"),
          { recursive: true },
        ),
      )
      expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
        { id: "demo", status: "missing" },
      ])
      expect(decode(yield* test.rpc.call("kilocode.marketplace", "install", input)).status).toBe("ready")
    }),
  )
}

it.live("retains the local manifest when database removal defects and retries after resource cleanup", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    let fail = true
    yield* test.start({
      ...test.host,
      storage: {
        ...test.host.storage,
        remove: (storedKey) =>
          fail && storedKey === key
            ? Effect.die(new Error("injected manifest removal failure"))
            : test.host.storage.remove(storedKey),
      },
    })
    yield* test.rpc.call("kilocode.marketplace", "install", input)
    expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
      type: "write_failed",
    })
    expect(yield* test.host.storage.get(key)).toBeDefined()
    expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(true)
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
      { status: "missing" },
    ])
    fail = false
    yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
    expect(yield* test.host.storage.get(key)).toBeUndefined()
    expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(false)
  }),
)

for (const resource of ["skill", "mcp"] as const) {
  it.live(`reports a modified ${resource} and refuses destructive replacement or removal`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start()
      yield* test.rpc.call("kilocode.marketplace", "install", input)
      const file =
        resource === "skill"
          ? path.join(test.directory, "skills", "guide", "SKILL.md")
          : path.join(test.directory, "kilo2.json")
      const modified =
        resource === "skill"
          ? "user edited guide"
          : JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://user.example.com" } } } })
      yield* Effect.promise(() => Bun.write(file, modified))
      const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
      expect(listed).toMatchObject([{ status: "modified" }])
      expect(listed[0].warnings?.join(" ")).toContain("modified")
      expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
        type: "conflict",
      })
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(modified)
      expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
        type: "conflict",
      })
      expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(modified)
      if (resource === "skill") {
        expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).json())).toEqual({
          mcp: { servers: {} },
        })
      }
      if (resource === "mcp") {
        expect(
          yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists()),
        ).toBe(false)
      }
      expect(yield* test.host.storage.get(key)).toBeDefined()
      expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(true)
    }),
  )
}

it.live("does not advertise a locally modified recovery journal as automatically repairable", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* test.start()
    const record = { ...decode(yield* test.rpc.call("kilocode.marketplace", "install", input)), recovering: true }
    yield* test.host.storage.set(key, JSON.stringify(record))
    yield* Effect.promise(() =>
      Bun.write(journal(test.directory), JSON.stringify({ directory: test.directory, record })),
    )
    yield* Effect.promise(() => Bun.write(path.join(test.directory, "skills", "guide", "SKILL.md"), "user replacement"))
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
      { status: "modified", recovering: true, warnings: expect.arrayContaining([expect.stringContaining("modified")]) },
    ])
  }),
)

it.live("recovers ownership from the local journal after the database is reset", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const installed = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* test.start()
        return decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
      }),
    )
    yield* test.host.storage.remove(key)
    yield* test.start()
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toEqual([installed])
    const repaired = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(repaired.status).toBe("ready")
    expect(yield* test.host.storage.get(key)).toBeDefined()
    yield* test.host.storage.remove(key)
    yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
    expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(false)
    expect(
      yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists()),
    ).toBe(false)
  }),
)

it.live("rebases scope-local ownership after a project rename and uninstalls from the new path", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const original = path.join(test.directory, "original")
    const renamed = path.join(test.directory, "renamed")
    yield* Effect.promise(() => fs.mkdir(original))
    const context = (directory: string) => ({
      ...test.host,
      location: {
        ...test.host.location,
        directory: AbsolutePath.make(directory),
        project: { ...test.host.location.project, directory: AbsolutePath.make(directory) },
      },
    })
    const projectInput = { ...input, scope: "project" } as const
    const oldKey = `installed:kilo:mcp:demo:project:${original}`
    // Re-registering uses a fresh plugin instance while preserving the real host's KV and RPC services.
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* test.start(context(original))
        const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", projectInput))
        expect(installed.project).toBe(original)
        expect(yield* Effect.promise(() => Bun.file(journal(path.join(original, ".kilo2"))).exists())).toBe(true)
      }),
    )
    yield* Effect.promise(() => fs.rename(original, renamed))
    yield* test.start(context(renamed))
    const installed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
    expect(installed).toHaveLength(1)
    expect(installed[0]).toMatchObject({
      project: renamed,
      paths: [path.join(renamed, ".kilo2", "skills", "guide")],
      status: "ready",
    })
    expect(installed[0].config).toBe(path.join(renamed, "kilo2.json"))
    expect(
      installed[0].resources?.every((resource) =>
        ("path" in resource ? resource.path : resource.config).startsWith(renamed),
      ),
    ).toBe(true)
    expect(yield* test.host.storage.get(oldKey)).toBeUndefined()
    yield* test.rpc.call("kilocode.marketplace", "uninstall", projectInput)
    expect(
      yield* Effect.promise(() => Bun.file(path.join(renamed, ".kilo2", "skills", "guide", "SKILL.md")).exists()),
    ).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(journal(path.join(renamed, ".kilo2"))).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(path.join(renamed, "kilo2.json")).json())).toEqual({
      mcp: { servers: {} },
    })
  }),
)

for (const failAt of [1, 2]) {
  it.live(`${failAt === 1 ? "initial" : "final"} database save failure retains a recoverable scope-local journal`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      let writes = 0
      yield* test.start({
        ...test.host,
        storage: {
          ...test.host.storage,
          set: (storedKey, value) =>
            Effect.gen(function* () {
              if (storedKey.startsWith("installed:") && ++writes === failAt)
                return yield* Effect.die(new Error("injected manifest save failure"))
              yield* test.host.storage.set(storedKey, value)
            }),
        },
      })
      expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
        type: "write_failed",
      })
      const local = yield* Effect.promise(() => Bun.file(journal(test.directory)).json())
      expect(local.directory).toBe(test.directory)
      expect(decode(local.record).resources).toHaveLength(2)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists()),
      ).toBe(failAt === 2)
      expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).exists())).toBe(failAt === 2)
      if (failAt === 1) expect(yield* test.host.storage.get(key)).toBeUndefined()
      if (failAt === 2) expect(decode(JSON.parse(String(yield* test.host.storage.get(key)))).recovering).toBe(true)
      const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
      expect(listed).toHaveLength(1)
      expect(listed[0].status).toBe(failAt === 1 ? "incomplete" : "ready")
      if (failAt === 1) expect(listed[0].warnings?.join(" ")).toContain("interrupted")
      expect(decode(yield* test.rpc.call("kilocode.marketplace", "install", input)).status).toBe("ready")
      yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
      expect(yield* test.host.storage.get(key)).toBeUndefined()
      expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(false)
    }),
  )
}

it.live("persists new and pending ownership before cleanup, retains failures, and retries durable cleanup", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const old = path.join(test.directory, "old.json")
    const unreadable = path.join(test.directory, "not-a-file.json")
    const obsolete = path.join(test.directory, "skills", "obsolete")
    const guide = path.join(test.directory, "skills", "guide")
    const config = path.join(test.directory, "kilo2.json")
    const legacy = JSON.stringify({ mcp: { servers: { legacy: { type: "remote", url: "https://legacy" } } } })
    const previous = JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://old" } } } })
    yield* Effect.promise(async () => {
      await Bun.write(old, previous)
      await Bun.write(unreadable, legacy)
      await fs.mkdir(obsolete, { recursive: true })
      await Bun.write(path.join(obsolete, "SKILL.md"), "obsolete guide")
    })
    const owned = yield* Effect.promise(async () =>
      Promise.all(
        [{ path: obsolete }, { config: old, server: "demo" }, { config: unreadable, server: "legacy" }].map(
          async (resource) => ({ ...resource, fingerprints: [(await Installer.resourceFingerprint(resource))!] }),
        ),
      ),
    )
    yield* Effect.promise(async () => {
      await Bun.write(old, "{ broken")
      await fs.rm(unreadable)
      await fs.mkdir(unreadable)
    })
    yield* test.host.storage.set(
      key,
      JSON.stringify({
        ...input,
        installedAt: 0,
        paths: [obsolete],
        config: old,
        resources: owned.slice(0, 2),
        pending: [owned[2]],
      }),
    )
    const snapshots: KiloMarketplaceRpc.Installed[] = []
    let rejectWrite = Infinity
    yield* test.start({
      ...test.host,
      storage: {
        ...test.host.storage,
        set: (key, value) =>
          Effect.gen(function* () {
            if (key.startsWith("installed:")) {
              const record = decode(JSON.parse(String(value)))
              if (snapshots.length === 0) {
                // The durable intent owns both old and planned resources before targets are written.
                expect(record).toMatchObject({
                  config,
                  paths: [guide],
                  recovering: true,
                  pending: owned,
                })
                expect(yield* Effect.promise(() => Bun.file(path.join(obsolete, "SKILL.md")).exists())).toBe(true)
                expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).exists())).toBe(false)
                expect(yield* Effect.promise(() => Bun.file(config).exists())).toBe(false)
              }
              snapshots.push(record)
              if (snapshots.length === rejectWrite) return yield* Effect.die(new Error("progress write failed"))
            }
            yield* test.host.storage.set(key, value)
          }),
      },
    })

    const first = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(first.pending).toEqual([owned[1], owned[2]])
    expect(first.warnings?.join(" ")).toContain("cleanup")
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))[0].warnings?.join(" ")).toContain(
      "cleanup",
    )
    expect(snapshots).toHaveLength(3)
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: first.pending })
    expect(yield* Effect.promise(() => fs.readdir(path.join(test.directory, "skills")))).toEqual(["guide"])

    // Uninstall may remove active resources, but a failed pending read must keep the manifest for retry.
    expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
      type: "invalid_params",
      message: expect.stringContaining("not valid JSON"),
    })
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: first.pending })
    expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(config).json())).toEqual({ mcp: { servers: {} } })
    expect(yield* Effect.promise(() => Bun.file(journal(test.directory)).exists())).toBe(true)
    const again = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(again.pending).toEqual(first.pending)
    expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).text())).toBe("new guide")

    yield* Effect.promise(async () => {
      await fs.rmdir(unreadable)
      await Bun.write(unreadable, legacy)
      await Bun.write(old, previous)
    })
    // A failed progress save must not reject a successful install or forget the durable cleanup list.
    rejectWrite = snapshots.length + 3
    const unsaved = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(unsaved.pending).toEqual(first.pending)
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: unsaved.pending })
    expect(unsaved.warnings?.join(" ")).toContain("cleanup")
    const finished = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(finished.pending).toBeUndefined()
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({
      paths: finished.paths,
      installedAt: finished.installedAt,
    })
    expect(yield* Effect.promise(() => Bun.file(old).json())).toEqual({ mcp: { servers: {} } })
    expect(yield* Effect.promise(() => Bun.file(unreadable).json())).toEqual({ mcp: { servers: {} } })
    yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
    expect(yield* test.host.storage.get(key)).toBeUndefined()
    expect(yield* Effect.promise(() => fs.readdir(path.join(test.directory, "skills")))).toEqual([])
  }),
)
