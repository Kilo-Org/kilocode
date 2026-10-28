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
const journalDirectory = (root: string) => path.join(root, ".marketplace")
const fixture = Effect.fn(function* (companion = false, skills = true) {
  const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-plugin-")))
  yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })))
  let archive = yield* Effect.promise(() => new Bun.Archive({ "SKILL.md": "new guide" }).bytes())
  let invalid = yield* Effect.promise(() =>
    new Bun.Archive({ "SKILL.md": "---\nname: 123\n---\nprivate body" }).bytes(),
  )
  let unavailable = false
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (unavailable) return new Response("Catalog temporarily unavailable", { status: 503 })
      const url = new URL(request.url)
      if (url.pathname === "/guide.tar") return new Response(archive)
      if (url.pathname === "/invalid.tar") return new Response(invalid)
      return new Response(
        Bun.YAML.stringify({
          items: url.pathname.endsWith("/skills")
            ? [{ id: "guide", content: new URL("/guide.tar", request.url).href }]
            : [
                {
                  id: "demo",
                  content: '{"url":"https://new.example.com/mcp"}',
                  skills: skills
                    ? [
                        { id: "guide", content: new URL("/guide.tar", request.url).href },
                        ...(companion ? [{ id: "invalid", content: new URL("/invalid.tar", request.url).href }] : []),
                      ]
                    : undefined,
                },
              ],
        }),
      )
    },
  })
  yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const rpc = yield* Rpc.Service
  return {
    directory,
    host,
    rpc,
    setSkill: async (content: string, later = false) => {
      const bytes = await new Bun.Archive({ "SKILL.md": content }).bytes()
      if (later) invalid = bytes
      if (!later) archive = bytes
    },
    failCatalog: () => {
      unavailable = true
    },
    start: (context = host) =>
      withEnv({ KILO_API_URL: server.url.origin }, () =>
        KiloMarketplacePlugin.effect(context).pipe(Effect.provide(Global.layerWith({ config: directory }))),
      ),
  }
})

for (const reinstall of [false, true]) {
  for (const companion of [false, true]) {
    it.live(
      `invalid ${companion ? "later companion" : "standalone skill"} preserves all files and ownership on ${reinstall ? "reinstall" : "first install"}`,
      () =>
        Effect.gen(function* () {
          const test = yield* fixture(companion)
          const writes: string[] = []
          yield* test.start({
            ...test.host,
            storage: {
              ...test.host.storage,
              set: (storedKey, value) => {
                if (storedKey.startsWith("installed:")) writes.push(storedKey)
                return test.host.storage.set(storedKey, value)
              },
            },
          })
          const request = companion ? input : ({ ...input, kind: "skill", id: "guide" } as const)
          const config = path.join(test.directory, "kilo2.json")
          yield* Effect.promise(() =>
            Bun.write(config, '{"mcp":{"servers":{"existing":{"url":"https://keep.example.com"}}}}'),
          )
          if (reinstall) {
            if (companion) yield* Effect.promise(() => test.setSkill("old later companion", true))
            yield* test.rpc.call("kilocode.marketplace", "install", request)
          }
          const before = yield* test.rpc.call("kilocode.marketplace", "installed", {})
          const files = yield* Effect.promise(async () =>
            (await fs.readdir(test.directory, { recursive: true })).toSorted(),
          )
          const manifests = yield* Effect.promise(() =>
            Promise.all(
              files
                .filter((file) => file.endsWith(".json"))
                .map((file) => Bun.file(path.join(test.directory, file)).text()),
            ),
          )
          const count = writes.length
          yield* Effect.promise(() => test.setSkill("---\ndescription: []\n---\nprivate body", companion))
          if (companion) yield* Effect.promise(() => test.setSkill("replacement guide"))
          expect(yield* test.rpc.call("kilocode.marketplace", "install", request).pipe(Effect.flip)).toMatchObject({
            type: "invalid_params",
            message: `Invalid skill ${companion ? "invalid" : "guide"}: frontmatter`,
          })
          expect(writes).toHaveLength(count)
          expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toEqual(before)
          expect(
            yield* Effect.promise(async () => (await fs.readdir(test.directory, { recursive: true })).toSorted()),
          ).toEqual(files)
          expect(
            yield* Effect.promise(() =>
              Promise.all(
                files
                  .filter((file) => file.endsWith(".json"))
                  .map((file) => Bun.file(path.join(test.directory, file)).text()),
              ),
            ),
          ).toEqual(manifests)
          const target = Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md"))
          if (reinstall) expect(yield* Effect.promise(() => target.text())).toBe("new guide")
          if (!reinstall) expect(yield* Effect.promise(() => target.exists())).toBe(false)
          if (reinstall && companion)
            expect(
              yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "invalid", "SKILL.md")).text()),
            ).toBe("old later companion")
        }),
    )
  }
}
for (const cached of ["memory", "persisted"] as const) {
  it.live(`serves a ${cached} snapshot with a warning on fetch failure`, () =>
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
it.live("stores the catalog snapshot under a versioned key and ignores the unversioned legacy row", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    // A row from before the key was versioned must never be read: it is an inert leftover.
    yield* test.host.storage.set("catalog:kilo:mcp:", JSON.stringify([{ id: "legacy", name: "Legacy" }]))
    yield* test.start()
    expect(yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp" })).toMatchObject({
      items: [{ id: "demo" }],
      failures: [],
    })
    const stored = yield* test.host.storage.get("catalog:v1:kilo:mcp")
    // A snapshot holds full catalog entries, not the flattened items the RPC returns.
    expect(JSON.parse(String(stored))).toMatchObject([{ item: { id: "demo" } }])
    const written = (yield* test.host.storage.scan({ prefix: "catalog:" })).entries.map((entry) => entry.key)
    expect(written).toContain("catalog:v1:kilo:mcp")
    // The leftover row is untouched, and with the network down a restart serves the versioned snapshot, not it.
    expect(JSON.parse(String(yield* test.host.storage.get("catalog:kilo:mcp:")))).toEqual([
      { id: "legacy", name: "Legacy" },
    ])
    test.failCatalog()
    yield* test.start()
    expect(yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp", refresh: true })).toMatchObject({
      items: [{ id: "demo" }],
      failures: [{ registry: "kilo" }],
    })
  }),
)
it.live("a catalog with no versioned snapshot reports the failure instead of serving a valid legacy row", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    // Build a legacy row that decodes, so the key alone decides whether it could be served.
    yield* test.start()
    yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp" })
    const snapshot = JSON.parse(String(yield* test.host.storage.get("catalog:v1:kilo:mcp")))
    snapshot[0].item.id = "legacy"
    yield* test.host.storage.remove("catalog:v1:kilo:mcp")
    yield* test.host.storage.set("catalog:kilo:mcp:", JSON.stringify(snapshot))
    test.failCatalog()
    yield* test.start()
    expect(
      yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp", refresh: true }).pipe(Effect.flip),
    ).toMatchObject({ type: "fetch_failed" })
  }),
)
it.live("cache write defects do not discard a successful catalog response; excluded methods are absent", () =>
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
    expect(Object.keys(KiloMarketplaceRpc.Definition.methods)).toEqual([
      "list",
      "installed",
      "preview",
      "install",
      "uninstall",
    ])
    expect(
      yield* test.rpc.call("kilocode.marketplace", "install", { ...input, registry: "other" }).pipe(Effect.flip),
    ).toMatchObject({ type: "not_found" })
  }),
)
it.live("persists intent in the database before target mutation and keeps no local journal", () =>
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
            expect(record.version).toBe(1)
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
    // The stored record names skill ids and a scope-relative config, never absolute locations.
    expect(snapshots[1]).toMatchObject({
      config: "kilo2.json",
      server: "demo",
      resources: [{ id: "guide" }, { server: "demo" }],
    })
    expect(JSON.stringify(snapshots[1])).not.toContain(test.directory)
    expect(
      yield* Effect.promise(() => fs.stat(journalDirectory(test.directory)).catch(() => undefined)),
    ).toBeUndefined()
  }),
)
for (const fault of ["installed scan", "installation read"] as const) {
  it.live(`converts ${fault} storage defects into declared errors`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.start({
        ...test.host,
        storage: {
          ...test.host.storage,
          get: (storedKey) =>
            fault === "installation read" && storedKey === key
              ? Effect.die(new Error(`injected ${fault}`))
              : test.host.storage.get(storedKey),
          scan: (options) =>
            fault === "installed scan" ? Effect.die(new Error(`injected ${fault}`)) : test.host.storage.scan(options),
        },
      })
      const failure = yield* test.rpc
        .call(
          "kilocode.marketplace",
          fault === "installed scan" ? "installed" : "uninstall",
          fault === "installed scan" ? {} : input,
        )
        .pipe(Effect.flip)
      expect(failure).toMatchObject({ type: "fetch_failed" })
      expect(JSON.stringify(failure)).toContain(`injected ${fault}`)
    }),
  )
}
it.live("skips an invalid stored record instead of failing, leaving files untouched", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* test.start()
    yield* test.rpc.call("kilocode.marketplace", "install", input)
    yield* test.rpc.call("kilocode.marketplace", "install", { ...input, kind: "skill", id: "guide" })
    yield* test.host.storage.set(key, "{ broken")
    // The other record stays listed; the broken one is skipped rather than hiding everything.
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
      { id: "guide", kind: "skill", status: "ready" },
    ])
    expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
      type: "not_found",
    })
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).text())).toBe(
      "new guide",
    )
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).json())).toMatchObject({
      mcp: { servers: { demo: { url: "https://new.example.com/mcp" } } },
    })
  }),
)
for (const resource of ["skill", "mcp"] as const) {
  it.live(`repairs missing ${resource} without losing ownership`, () =>
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
  it.live(`refuses destructive replacement or removal of modified ${resource}`, () =>
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
      for (const method of ["install", "uninstall"] as const) {
        expect(yield* test.rpc.call("kilocode.marketplace", method, input).pipe(Effect.flip)).toMatchObject({
          type: "conflict",
        })
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(modified)
      }
      if (resource === "skill")
        expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).json())).toEqual({
          mcp: { servers: {} },
        })
      if (resource === "mcp")
        expect(
          yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists()),
        ).toBe(false)
      expect(yield* test.host.storage.get(key)).toBeDefined()
    }),
  )
}
it.live("retains the database record after removal defects and retries cleanup", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    let fail = true
    yield* test.start({
      ...test.host,
      storage: {
        ...test.host.storage,
        remove: (storedKey) =>
          fail && storedKey === key
            ? Effect.die(new Error("injected removal failure"))
            : test.host.storage.remove(storedKey),
      },
    })
    yield* test.rpc.call("kilocode.marketplace", "install", input)
    expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
      type: "write_failed",
    })
    expect(yield* test.host.storage.get(key)).toBeDefined()
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
      { status: "missing" },
    ])
    fail = false
    yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
    expect(yield* test.host.storage.get(key)).toBeUndefined()
  }),
)
it.live("does not advertise a modified recovery record as automatically repairable", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* test.start()
    yield* test.rpc.call("kilocode.marketplace", "install", input)
    // Seed from the stored form: the returned record carries a resolved, absolute config.
    const record = { ...JSON.parse(String(yield* test.host.storage.get(key))), recovering: true }
    yield* test.host.storage.set(key, JSON.stringify(record))
    yield* Effect.promise(() => Bun.write(path.join(test.directory, "skills", "guide", "SKILL.md"), "user replacement"))
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
      { status: "modified", recovering: true, warnings: expect.arrayContaining([expect.stringContaining("modified")]) },
    ])
  }),
)
it.live("a reset database loses ownership, then reinstall adopts identical files and protects divergent ones", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* test.start()
    const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    yield* test.host.storage.remove(key)
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toEqual([])
    // Identical files are adopted, so ownership returns without rewriting or conflicting.
    const adopted = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(adopted).toMatchObject({ status: "ready", resources: installed.resources })
    expect(yield* test.host.storage.get(key)).toBeDefined()
    // Divergent files stay protected once ownership is lost again.
    yield* test.host.storage.remove(key)
    yield* Effect.promise(() =>
      Bun.write(path.join(test.directory, "skills", "guide", "SKILL.md"), "user edited guide"),
    )
    expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
      type: "conflict",
    })
    expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).text())).toBe(
      "user edited guide",
    )
    expect(yield* test.host.storage.get(key)).toBeUndefined()
  }),
)
it.live("a renamed project has no record, and reinstall adopts the moved files without duplicates", () =>
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
    const request = { ...input, scope: "project" } as const
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* test.start(context(original))
        expect(decode(yield* test.rpc.call("kilocode.marketplace", "install", request)).project).toBe(original)
      }),
    )
    yield* Effect.promise(() => fs.rename(original, renamed))
    yield* test.start(context(renamed))
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toEqual([])
    const adopted = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
    expect(adopted).toMatchObject({
      project: renamed,
      status: "ready",
      config: path.join(renamed, "kilo2.json"),
      resources: [{ id: "guide" }, { server: "demo" }],
    })
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toHaveLength(1)
    yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
    expect(
      yield* Effect.promise(() => Bun.file(path.join(renamed, ".kilo2", "skills", "guide", "SKILL.md")).exists()),
    ).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(path.join(renamed, "kilo2.json")).json())).toEqual({
      mcp: { servers: {} },
    })
  }),
)
;(process.platform === "win32" ? it.live.skip : it.live)(
  "project config retargeted outside its native locations refuses install and uninstall",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture(false, false)
      const project = path.join(test.directory, "project")
      yield* Effect.promise(() => fs.mkdir(project))
      yield* test.start({
        ...test.host,
        location: {
          ...test.host.location,
          directory: AbsolutePath.make(project),
          project: { ...test.host.location.project, directory: AbsolutePath.make(project) },
        },
      })
      const request = { ...input, scope: "project" } as const
      decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
      const config = path.join(project, "kilo2.json")
      const original = path.join(project, "original.json")
      const changed = path.join(project, "elsewhere.json")
      const content = yield* Effect.promise(() => Bun.file(config).text())
      yield* Effect.promise(async () => {
        await fs.rename(config, original)
        await Bun.write(changed, content)
        await fs.symlink(changed, config)
      })
      // Neither operation may write through the link into a file outside the native config locations.
      for (const method of ["install", "uninstall"] as const)
        expect(yield* test.rpc.call("kilocode.marketplace", method, request).pipe(Effect.flip)).toMatchObject({
          type: "conflict",
        })
      expect(yield* Effect.promise(() => Bun.file(original).text())).toBe(content)
      expect(yield* Effect.promise(() => Bun.file(changed).text())).toBe(content)
      expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${project}`)).toBeDefined()
      // The list stays usable: the record that cannot be inspected is flagged instead of failing every record.
      expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toMatchObject([
        {
          id: "demo",
          status: "modified",
          warnings: [expect.stringContaining("outside its native config locations")],
        },
      ])
    }),
)
for (const missing of [false, true]) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `reinstall through a higher-priority alias ${missing ? "repairs a missing" : "retains an owned"} server`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture(false, false)
        yield* test.start({
          ...test.host,
          location: {
            ...test.host.location,
            directory: AbsolutePath.make(test.directory),
            project: { ...test.host.location.project, directory: AbsolutePath.make(test.directory) },
          },
        })
        const request = { ...input, scope: "project" } as const
        const first = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
        const real = first.config!
        const config = path.join(test.directory, ".kilo2", "kilo2.jsonc")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.dirname(config), { recursive: true })
          await fs.symlink("../kilo2.json", config)
          if (missing) await Bun.write(real, '{"mcp":{"servers":{}}}')
        })
        const record = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
        expect(record).toMatchObject({ config, status: "ready" })
        expect(record.pending).toBeUndefined()
        expect(record.resources).toEqual(first.resources)
        expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))[0].status).toBe("ready")
        expect(yield* Effect.promise(() => Bun.file(real).json())).toEqual({
          mcp: { servers: { demo: { type: "remote", url: "https://new.example.com/mcp" } } },
        })
        yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
        expect(yield* Effect.promise(() => fs.readlink(config))).toBe("../kilo2.json")
        expect(yield* Effect.promise(() => Bun.file(real).json())).toEqual({ mcp: { servers: {} } })
      }),
  )
}
for (const destination of ["external", "project-file", "missing"] as const) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `rejects first MCP install through unowned ${destination} symlink before intent`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const project = path.join(test.directory, "project")
        const target = path.join(destination === "project-file" ? project : test.directory, "settings.jsonc")
        const config = path.join(project, "kilo2.json")
        const content = '{"keep":"unchanged"}'
        yield* Effect.promise(async () => {
          await fs.mkdir(project)
          if (destination !== "missing") await Bun.write(target, content)
          await fs.symlink(target, config)
        })
        yield* test.start({
          ...test.host,
          location: {
            ...test.host.location,
            directory: AbsolutePath.make(project),
            project: { ...test.host.location.project, directory: AbsolutePath.make(project) },
          },
        })
        expect(
          yield* test.rpc.call("kilocode.marketplace", "install", { ...input, scope: "project" }).pipe(Effect.flip),
        ).toMatchObject({ type: "conflict", message: expect.stringContaining("outside its native config locations") })
        expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${project}`)).toBeUndefined()
        expect(yield* Effect.promise(() => fs.readlink(config))).toBe(target)
        if (destination !== "missing") expect(yield* Effect.promise(() => Bun.file(target).text())).toBe(content)
        if (destination === "missing") expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        expect(
          decode(
            yield* test.rpc.call("kilocode.marketplace", "install", {
              ...input,
              kind: "skill",
              id: "guide",
              scope: "project",
            }),
          ).status,
        ).toBe("ready")
        if (destination !== "missing") expect(yield* Effect.promise(() => Bun.file(target).text())).toBe(content)
        if (destination === "missing") expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
      }),
  )
}

for (const failAt of [1, 2]) {
  it.live(`${failAt === 1 ? "initial" : "final"} database save failure leaves a recoverable state`, () =>
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
                return yield* Effect.die(new Error("injected save failure"))
              yield* test.host.storage.set(storedKey, value)
            }),
        },
      })
      expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
        type: "write_failed",
      })
      expect(
        yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).exists()),
      ).toBe(failAt === 2)
      expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).exists())).toBe(failAt === 2)
      if (failAt === 1) expect(yield* test.host.storage.get(key)).toBeUndefined()
      if (failAt === 2) expect(decode(JSON.parse(String(yield* test.host.storage.get(key)))).recovering).toBe(true)
      const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
      // A failed first write aborts before any mutation, so there is nothing to recover. A failed final
      // write leaves the intent record, which reports the install as incomplete until a retry finishes it.
      if (failAt === 1) expect(listed).toEqual([])
      if (failAt === 2) {
        expect(listed).toHaveLength(1)
        expect(listed[0].status).toBe("incomplete")
        expect(listed[0].warnings?.join(" ")).toContain("interrupted")
      }
      expect(decode(yield* test.rpc.call("kilocode.marketplace", "install", input)).status).toBe("ready")
      yield* test.rpc.call("kilocode.marketplace", "uninstall", input)
      expect(yield* test.host.storage.get(key)).toBeUndefined()
    }),
  )
}
it.live("persists pending ownership before cleanup, retains failures and retries durable cleanup", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const request = { ...input, scope: "project" } as const
    const key = `installed:kilo:mcp:demo:project:${test.directory}`
    const root = path.join(test.directory, ".kilo2")
    const unreadable = path.join(test.directory, "kilo2.json")
    const obsolete = path.join(root, "skills", "obsolete")
    const guide = path.join(root, "skills", "guide")
    const config = path.join(root, "kilo2.jsonc")
    const legacy = JSON.stringify({ mcp: { servers: { legacy: { type: "remote", url: "https://legacy" } } } })
    yield* Effect.promise(async () => {
      await Bun.write(unreadable, legacy)
      await fs.mkdir(obsolete, { recursive: true })
      await Bun.write(path.join(obsolete, "SKILL.md"), "obsolete guide")
      await Bun.write(config, "{}")
    })
    // Obsolete ownership: a skill tree and a server that is found by scanning the native configs.
    const fingerprints = yield* Effect.promise(async () =>
      Promise.all(
        [{ path: obsolete }, { config: unreadable, server: "legacy" }].map(async (resource) => [
          (await Installer.resourceFingerprint(resource))!,
        ]),
      ),
    )
    const wire = [
      { id: "obsolete", fingerprints: fingerprints[0] },
      { server: "legacy", fingerprints: fingerprints[1] },
    ]
    // The legacy entry's file is unreadable (a directory) until the end, so its cleanup fails and is retained.
    yield* Effect.promise(async () => {
      await fs.rm(unreadable)
      await fs.mkdir(unreadable)
    })
    yield* test.host.storage.set(
      key,
      JSON.stringify({
        ...request,
        project: test.directory,
        installedAt: 0,
        resources: [],
        pending: wire,
      }),
    )
    const snapshots: KiloMarketplaceRpc.Installed[] = []
    let rejectWrite = Infinity
    yield* test.start({
      ...test.host,
      location: {
        ...test.host.location,
        directory: AbsolutePath.make(test.directory),
        project: { ...test.host.location.project, directory: AbsolutePath.make(test.directory) },
      },
      storage: {
        ...test.host.storage,
        set: (key, value) =>
          Effect.gen(function* () {
            if (key.startsWith("installed:")) {
              const record = decode(JSON.parse(String(value)))
              if (snapshots.length === 0) {
                expect(record).toMatchObject({
                  config: path.join(".kilo2", "kilo2.jsonc"),
                  resources: [{ id: "guide" }, { server: "demo" }],
                  recovering: true,
                  pending: wire,
                })
                expect(yield* Effect.promise(() => Bun.file(path.join(obsolete, "SKILL.md")).exists())).toBe(true)
                expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).exists())).toBe(false)
                expect(yield* Effect.promise(() => Bun.file(config).json())).toEqual({})
              }
              snapshots.push(record)
              if (snapshots.length === rejectWrite) return yield* Effect.die(new Error("progress write failed"))
            }
            yield* test.host.storage.set(key, value)
          }),
      },
    })
    // The obsolete skill is cleaned; the unreadable legacy file keeps its entry pending.
    const first = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
    expect(first.pending).toEqual([wire[1]])
    expect(first.warnings?.join(" ")).toContain("cleanup")
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))[0].warnings?.join(" ")).toContain(
      "cleanup",
    )
    expect(snapshots).toHaveLength(3)
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: first.pending })
    expect(yield* Effect.promise(() => fs.readdir(path.join(root, "skills")))).toEqual(["guide"])
    expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).text())).toBe("new guide")
    // A retry while the file is still unreadable retains the same pending ownership.
    expect(decode(yield* test.rpc.call("kilocode.marketplace", "install", request)).pending).toEqual(first.pending)
    yield* Effect.promise(async () => {
      await fs.rmdir(unreadable)
      await Bun.write(unreadable, legacy)
    })
    // The file is readable now, but recording the cleanup fails: ownership stays pending for another retry.
    // Saves per install: intent, final record, then one per cleaned resource. Reject the cleanup progress write.
    rejectWrite = snapshots.length + 3
    const unsaved = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
    expect(unsaved.pending).toEqual(first.pending)
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: unsaved.pending })
    expect(unsaved.warnings?.join(" ")).toContain("cleanup")
    const finished = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
    expect(finished.pending).toBeUndefined()
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({
      resources: finished.resources,
      installedAt: finished.installedAt,
    })
    expect(yield* Effect.promise(() => Bun.file(unreadable).json())).toEqual({ mcp: { servers: {} } })
    yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
    expect(yield* test.host.storage.get(key)).toBeUndefined()
    expect(yield* Effect.promise(() => fs.readdir(path.join(root, "skills")))).toEqual([])
  }),
)
