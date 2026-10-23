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
    fetch: (request) =>
      unavailable
        ? new Response("Catalog temporarily unavailable", { status: 503 })
        : new URL(request.url).pathname === "/guide.tar"
          ? new Response(archive)
          : new URL(request.url).pathname === "/invalid.tar"
            ? new Response(invalid)
            : new URL(request.url).pathname.endsWith("/skills")
              ? new Response(`items:\n  - id: guide\n    content: ${new URL("/guide.tar", request.url).href}\n`)
              : new Response(`items:
  - id: demo
    content: '{"url":"https://new.example.com/mcp"}'
${
  skills
    ? `    skills:
      - id: guide
        content: ${new URL("/guide.tar", request.url).href}
${companion ? `      - id: invalid\n        content: ${new URL("/invalid.tar", request.url).href}\n` : ""}`
    : ""
}
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
  it.live(
    `invalid standalone skill ${reinstall ? "reinstall preserves ownership" : "first install creates no ownership"}`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture()
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
        const skill = { ...input, kind: "skill", id: "guide" } as const
        yield* Effect.promise(() => Bun.write(path.join(test.directory, "kilo2.json"), '{"mcp":{"servers":{}}}'))
        if (reinstall) yield* test.rpc.call("kilocode.marketplace", "install", skill)
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
        yield* Effect.promise(() => test.setSkill("---\ndescription: []\n---\nprivate body"))
        const failure = yield* test.rpc.call("kilocode.marketplace", "install", skill).pipe(Effect.flip)
        expect(failure).toMatchObject({ type: "invalid_params", message: "Invalid skill guide: frontmatter" })
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
      }),
  )
}

for (const reinstall of [false, true]) {
  it.live(
    `an invalid later MCP companion prevents all mutations and durable intent on ${reinstall ? "reinstall" : "first install"}`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture(true)
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
        const config = path.join(test.directory, "kilo2.json")
        yield* Effect.promise(() =>
          Bun.write(config, '{"mcp":{"servers":{"existing":{"url":"https://keep.example.com"}}}}'),
        )
        if (reinstall) {
          yield* Effect.promise(() => test.setSkill("old later companion", true))
          yield* test.rpc.call("kilocode.marketplace", "install", input)
          yield* Effect.promise(() => test.setSkill("---\nname: 123\n---\nprivate body", true))
          yield* Effect.promise(() => test.setSkill("replacement guide"))
        }
        const before = yield* Effect.promise(() => Bun.file(config).text())
        const record = yield* test.host.storage.get(key)
        const manifest = yield* Effect.promise(() =>
          Bun.file(journal(test.directory))
            .text()
            .catch(() => undefined),
        )
        const files = yield* Effect.promise(async () =>
          (await fs.readdir(test.directory, { recursive: true })).toSorted(),
        )
        const count = writes.length
        expect(yield* test.rpc.call("kilocode.marketplace", "install", input).pipe(Effect.flip)).toMatchObject({
          type: "invalid_params",
          message: "Invalid skill invalid: frontmatter",
        })
        expect(writes).toHaveLength(count)
        expect(yield* test.host.storage.get(key)).toEqual(record)
        expect(
          yield* Effect.promise(() =>
            Bun.file(journal(test.directory))
              .text()
              .catch(() => undefined),
          ),
        ).toBe(manifest)
        expect(
          yield* Effect.promise(async () => (await fs.readdir(test.directory, { recursive: true })).toSorted()),
        ).toEqual(files)
        expect(yield* Effect.promise(() => Bun.file(config).text())).toBe(before)
        if (!reinstall) expect(yield* test.rpc.call("kilocode.marketplace", "installed", {})).toEqual([])
        if (reinstall) {
          expect(
            yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "guide", "SKILL.md")).text()),
          ).toBe("new guide")
          expect(
            yield* Effect.promise(() => Bun.file(path.join(test.directory, "skills", "invalid", "SKILL.md")).text()),
          ).toBe("old later companion")
        }
      }),
  )
}

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

for (const field of [
  "paths",
  "config",
  "resource-skill",
  "resource-config",
  "pending-skill",
  "pending-config",
] as const) {
  it.live(`rejects repository-controlled recovery ${field} outside managed destinations before any mutation`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const projectInput = { ...input, scope: "project" } as const
      const source = path.join(test.directory, "src")
      const config = path.join(test.directory, "source.json")
      const content = '{"mcp":{"servers":{"demo":{"type":"remote","url":"https://keep.example.com"}}}}'
      yield* Effect.promise(async () => {
        await Bun.write(path.join(source, "SKILL.md"), "tracked source")
        await Bun.write(config, content)
      })
      const skillFingerprint = yield* Effect.promise(() => Installer.resourceFingerprint({ path: source }))
      const configFingerprint = yield* Effect.promise(() => Installer.resourceFingerprint({ config, server: "demo" }))
      const resource = field.endsWith("config")
        ? { config: "/source.json", server: "demo", fingerprints: [configFingerprint!] }
        : { path: "/src", fingerprints: [skillFingerprint!] }
      const record = {
        ...projectInput,
        project: "/",
        installedAt: 0,
        paths: field === "paths" ? ["/src"] : [],
        ...(field === "config" ? { config: "/source.json", server: "demo" } : {}),
        resources: field.startsWith("resource-") ? [resource] : [],
        ...(field.startsWith("pending-") ? { pending: [resource] } : {}),
      }
      yield* Effect.promise(() =>
        Bun.write(journal(path.join(test.directory, ".kilo2")), JSON.stringify({ directory: "/", record })),
      )
      yield* test.start({
        ...test.host,
        location: {
          ...test.host.location,
          directory: AbsolutePath.make(test.directory),
          project: { ...test.host.location.project, directory: AbsolutePath.make(test.directory) },
        },
      })
      for (const method of ["installed", "install", "uninstall"] as const) {
        expect(
          yield* test.rpc
            .call("kilocode.marketplace", method, method === "installed" ? {} : projectInput)
            .pipe(Effect.flip),
        ).toMatchObject({ type: "fetch_failed", message: expect.stringContaining("outside its installation scope") })
        expect(yield* Effect.promise(() => Bun.file(path.join(source, "SKILL.md")).text())).toBe("tracked source")
        expect(yield* Effect.promise(() => Bun.file(config).text())).toBe(content)
      }
    }),
  )
}

;(process.platform === "win32" ? it.live.skip : it.live)(
  "rejects recovery through a repository-controlled skills-directory symlink",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const root = path.join(test.directory, ".kilo2")
      const source = path.join(test.directory, "src", "guide")
      yield* Effect.promise(() => Bun.write(path.join(source, "SKILL.md"), "tracked source"))
      const fingerprint = yield* Effect.promise(() => Installer.resourceFingerprint({ path: source }))
      yield* Effect.promise(async () => {
        await fs.mkdir(root)
        await fs.symlink(path.join(test.directory, "src"), path.join(root, "skills"))
        await Bun.write(
          journal(root),
          JSON.stringify({
            directory: test.directory,
            record: {
              ...input,
              scope: "project",
              project: test.directory,
              installedAt: 0,
              paths: [path.join(root, "skills", "guide")],
              resources: [{ path: path.join(root, "skills", "guide"), fingerprints: [fingerprint] }],
            },
          }),
        )
      })
      yield* test.start({
        ...test.host,
        location: {
          ...test.host.location,
          directory: AbsolutePath.make(test.directory),
          project: { ...test.host.location.project, directory: AbsolutePath.make(test.directory) },
        },
      })
      expect(
        yield* test.rpc.call("kilocode.marketplace", "uninstall", { ...input, scope: "project" }).pipe(Effect.flip),
      ).toMatchObject({
        type: "fetch_failed",
        message: expect.stringContaining("Unsafe marketplace recovery directory"),
      })
      expect(yield* Effect.promise(() => Bun.file(path.join(source, "SKILL.md")).text())).toBe("tracked source")
    }),
)

for (const scope of ["global", "project"] as const) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `${scope} recovery preserves the recorded target after config symlink retargeting`,
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
        const request = { ...input, scope }
        const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
        const config = installed.config!
        const original = path.join(path.dirname(config), "original.json")
        const changed = path.join(
          path.dirname(config),
          ...(scope === "global" ? ["changed.json"] : [".kilo2", "kilo2.jsonc"]),
        )
        const content = yield* Effect.promise(() => Bun.file(config).text())
        yield* Effect.promise(async () => {
          await fs.rename(config, original)
          await Bun.write(changed, content)
          await fs.symlink(changed, config)
        })
        const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
        expect(listed[0]).toMatchObject({ status: "modified", resources: installed.resources })
        expect(listed[0].warnings?.join(" ")).toContain("target changed since installation")
        for (const method of ["install", "uninstall"] as const) {
          expect(yield* test.rpc.call("kilocode.marketplace", method, request).pipe(Effect.flip)).toMatchObject({
            type: "conflict",
          })
          expect(yield* Effect.promise(() => Bun.file(original).text())).toBe(content)
          expect(yield* Effect.promise(() => Bun.file(changed).text())).toBe(content)
        }
      }),
  )
}

for (const missing of [false, true]) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `reinstall through a higher-priority config alias ${missing ? "repairs a missing" : "retains an owned"} server`,
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
        const config = path.join(test.directory, ".kilo2", "kilo2.jsonc")
        yield* Effect.promise(async () => {
          await fs.symlink("../kilo2.json", config)
          if (missing) await Bun.write(first.config!, '{"mcp":{"servers":{}}}')
        })
        const record = decode(yield* test.rpc.call("kilocode.marketplace", "install", request))
        expect(record).toMatchObject({ config, status: "ready" })
        expect(record.pending).toBeUndefined()
        expect(record.resources).toEqual(first.resources?.map((resource) => ({ ...resource, config })))
        expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))[0].status).toBe("ready")
        expect(yield* Effect.promise(() => Bun.file(first.config!).json())).toEqual({
          mcp: { servers: { demo: { type: "remote", url: "https://new.example.com/mcp" } } },
        })
        yield* test.rpc.call("kilocode.marketplace", "uninstall", request)
        expect(yield* Effect.promise(() => fs.readlink(config))).toBe("../kilo2.json")
        expect(yield* Effect.promise(() => Bun.file(first.config!).json())).toEqual({ mcp: { servers: {} } })
      }),
  )
}

for (const linked of ["root", "skills"] as const) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `rejects an initial MCP-only install with a symlinked ${linked} before durable intent`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture(false, false)
        const root = path.join(test.directory, ".kilo2")
        const shared = path.join(test.directory, "shared")
        yield* Effect.promise(async () => {
          await fs.mkdir(shared)
          if (linked === "skills") await fs.mkdir(root)
          await fs.symlink(shared, linked === "root" ? root : path.join(root, "skills"))
        })
        yield* test.start({
          ...test.host,
          location: {
            ...test.host.location,
            directory: AbsolutePath.make(test.directory),
            project: { ...test.host.location.project, directory: AbsolutePath.make(test.directory) },
          },
        })
        for (const method of ["preview", "install", "installed", "install", "uninstall"] as const) {
          expect(
            yield* test.rpc
              .call("kilocode.marketplace", method, method === "installed" ? {} : { ...input, scope: "project" })
              .pipe(Effect.flip),
          ).toMatchObject({
            type: "fetch_failed",
            message: expect.stringContaining("Unsafe marketplace recovery directory"),
          })
          expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${test.directory}`)).toBeUndefined()
          expect(yield* Effect.promise(() => Bun.file(journal(root)).exists())).toBe(false)
          expect(yield* Effect.promise(() => Bun.file(path.join(test.directory, "kilo2.json")).exists())).toBe(false)
          expect(yield* Effect.promise(() => fs.readdir(shared))).toEqual([])
        }
      }),
  )
}

for (const destination of ["external", "project-file", "missing"] as const) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `rejects a first MCP install through an unowned ${destination} config symlink before durable intent`,
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
        ).toMatchObject({ type: "conflict", message: expect.stringContaining("no machine-local ownership") })
        expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${project}`)).toBeUndefined()
        expect(yield* Effect.promise(() => Bun.file(journal(path.join(project, ".kilo2"))).exists())).toBe(false)
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

for (const scenario of [
  "direct",
  "other-project",
  "storage-failure",
  "retirement-save-failure",
  "journal-failure",
  "removal-failure",
  "retirement-failure",
  "copy",
] as const) {
  for (const method of ["installed", "install", "uninstall"] as const) {
    ;(process.platform === "win32" ? it.live.skip : it.live)(
      `${method} recovers a renamed project's machine-owned external config after ${scenario}`,
      () =>
        Effect.gen(function* () {
          const test = yield* fixture()
          const original = path.join(test.directory, "original")
          const renamed = path.join(test.directory, "renamed")
          const external = path.join(test.directory, "dotfiles.jsonc")
          const config = path.join(original, "kilo2.jsonc")
          const projectInput = { ...input, scope: "project" } as const
          const oldKey = `installed:kilo:mcp:demo:project:${original}`
          const newKey = `installed:kilo:mcp:demo:project:${renamed}`
          const context = (directory: string) => ({
            ...test.host,
            location: {
              ...test.host.location,
              directory: AbsolutePath.make(directory),
              project: { ...test.host.location.project, directory: AbsolutePath.make(directory) },
            },
          })
          yield* Effect.promise(async () => {
            await fs.mkdir(original)
            await Bun.write(config, "{}")
          })
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* test.start(context(original))
              const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", projectInput))
              yield* test.rpc.call("kilocode.marketplace", "install", { ...input, kind: "skill", id: "guide" })
              yield* Effect.promise(async () => {
                await fs.rename(config, external)
                await fs.symlink(external, config)
              })
              const destination = yield* Effect.promise(() => fs.realpath(external))
              const owned = {
                ...installed,
                resources: installed.resources?.map((resource) =>
                  "config" in resource ? { ...resource, target: destination } : resource,
                ),
              }
              yield* test.host.storage.set(oldKey, JSON.stringify(owned))
              yield* Effect.promise(() =>
                Bun.write(
                  journal(path.join(original, ".kilo2")),
                  JSON.stringify({ directory: original, record: owned }),
                ),
              )
            }),
          )
          yield* Effect.promise(() =>
            scenario === "copy"
              ? fs.cp(original, renamed, { recursive: true, verbatimSymlinks: true })
              : fs.rename(original, renamed),
          )
          if (scenario === "other-project") {
            const other = path.join(test.directory, "other")
            yield* Effect.promise(() => fs.mkdir(other))
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* test.start(context(other))
                yield* test.rpc.call("kilocode.marketplace", "installed", {})
              }),
            )
            expect(yield* test.host.storage.get(oldKey)).toBeDefined()
          }
          let failMigration = scenario === "storage-failure"
          let failRetirement = scenario === "retirement-save-failure"
          let failJournal = scenario === "journal-failure"
          let failRemoval = scenario === "removal-failure" || scenario === "retirement-failure"
          const writes: string[] = []
          const recovery = journal(path.join(renamed, ".kilo2"))
          yield* test.start({
            ...context(renamed),
            storage: {
              ...test.host.storage,
              set: (key, value) => {
                writes.push(key)
                if (failMigration && key === newKey) {
                  failMigration = false
                  return Effect.die(new Error("injected ownership migration failure"))
                }
                if (failRetirement && key === `retiring:${newKey}`) {
                  failRetirement = false
                  return Effect.die(new Error("injected retirement marker failure"))
                }
                if (failJournal && key === newKey) {
                  failJournal = false
                  return Effect.gen(function* () {
                    yield* test.host.storage.set(key, value)
                    yield* Effect.promise(async () => {
                      await fs.rename(recovery, `${recovery}.backup`)
                      await fs.mkdir(recovery)
                    })
                  })
                }
                return test.host.storage.set(key, value)
              },
              remove: (key) => {
                if (failRemoval && key === (scenario === "removal-failure" ? oldKey : `retiring:${newKey}`)) {
                  failRemoval = false
                  return Effect.die(new Error("injected ownership retirement failure"))
                }
                return test.host.storage.remove(key)
              },
            },
          })
          yield* test.rpc.call("kilocode.marketplace", "list", { kind: "mcp" })
          const before = yield* Effect.promise(() => Bun.file(recovery).text())
          const writesBefore = writes.length
          expect(yield* test.rpc.call("kilocode.marketplace", "preview", projectInput)).toMatchObject({
            config: path.join(renamed, "kilo2.jsonc"),
          })
          expect(writes).toHaveLength(writesBefore)
          expect(yield* Effect.promise(() => Bun.file(recovery).text())).toBe(before)
          expect(yield* test.host.storage.get(oldKey)).toBeDefined()
          expect(yield* test.host.storage.get(newKey)).toBeUndefined()
          if (scenario === "storage-failure") {
            expect(
              yield* test.rpc
                .call("kilocode.marketplace", method, method === "installed" ? {} : projectInput)
                .pipe(Effect.flip),
            ).toMatchObject({
              type: "write_failed",
              message: expect.stringContaining("injected ownership migration failure"),
            })
            expect(yield* test.host.storage.get(oldKey)).toBeDefined()
            expect(yield* test.host.storage.get(newKey)).toBeUndefined()
            expect(yield* Effect.promise(() => Bun.file(journal(path.join(renamed, ".kilo2"))).json())).toMatchObject({
              directory: original,
            })
          }
          if (
            scenario === "journal-failure" ||
            scenario === "removal-failure" ||
            scenario === "retirement-failure" ||
            scenario === "retirement-save-failure"
          ) {
            expect(
              yield* test.rpc
                .call("kilocode.marketplace", method, method === "installed" ? {} : projectInput)
                .pipe(Effect.flip),
            ).toMatchObject({ type: "write_failed" })
            expect(yield* test.host.storage.get(newKey)).toBeDefined()
            if (scenario === "retirement-save-failure") {
              expect(yield* test.host.storage.get(`retiring:${newKey}`)).toBeUndefined()
              expect(yield* Effect.promise(() => Bun.file(recovery).text())).toBe(before)
            }
            if (scenario !== "retirement-save-failure")
              expect(yield* test.host.storage.get(`retiring:${newKey}`)).toBeDefined()
            if (scenario !== "retirement-failure") expect(yield* test.host.storage.get(oldKey)).toBeDefined()
            if (scenario === "removal-failure") yield* Effect.promise(() => fs.mkdir(original))
            if (scenario === "journal-failure") {
              yield* Effect.promise(async () => {
                await fs.rmdir(recovery)
                await fs.rename(`${recovery}.backup`, recovery)
              })
            }
          }
          yield* test.rpc.call("kilocode.marketplace", method, method === "installed" ? {} : projectInput)
          const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
          expect(listed.find((record) => record.kind === "skill")).toMatchObject({ id: "guide", status: "ready" })
          if (method !== "uninstall") {
            expect(listed.find((record) => record.kind === "mcp")).toMatchObject({
              id: "demo",
              status: "ready",
              project: renamed,
            })
            expect(yield* test.host.storage.get(newKey)).toBeDefined()
          }
          if (scenario !== "copy") expect(yield* test.host.storage.get(oldKey)).toBeUndefined()
          expect(yield* test.host.storage.get(`retiring:${newKey}`)).toBeUndefined()
          expect(yield* Effect.promise(() => fs.readlink(path.join(renamed, "kilo2.jsonc")))).toBe(external)
          if (scenario === "copy") {
            expect(yield* test.host.storage.get(oldKey)).toBeDefined()
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* test.start(context(original))
                const source = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
                expect(source.find((record) => record.kind === "mcp")).toMatchObject({ id: "demo", project: original })
              }),
            )
          }
        }),
    )
  }
}

for (const field of ["resources", "pending"] as const) {
  for (const relocated of [false, true]) {
    for (const missing of [false, true]) {
      ;(process.platform === "win32" ? it.live.skip : it.live)(
        `rejects ${relocated ? "relocated" : "same-project"} journal ${field} target laundering into ${missing ? "missing" : "existing"} external config`,
        () =>
          Effect.gen(function* () {
            const test = yield* fixture(false, false)
            const project = path.join(test.directory, "project")
            const config = path.join(project, "kilo2.json")
            const external = path.join(yield* Effect.promise(() => fs.realpath(test.directory)), "external.json")
            const source = relocated ? path.parse(project).root : project
            const sourceConfig = path.join(source, "kilo2.json")
            const recovery = journal(path.join(project, ".kilo2"))
            const content = '{"keep":"unchanged"}'
            const record = {
              ...input,
              scope: "project",
              project: source,
              config: sourceConfig,
              server: "demo",
              paths: [],
              resources: [],
              [field]: [{ config: sourceConfig, server: "demo", target: external, fingerprints: ["forged"] }],
              installedAt: 0,
            }
            const journalContent = JSON.stringify({ directory: source, record })
            yield* Effect.promise(async () => {
              await fs.mkdir(project)
              await Bun.write(config, "{}")
              if (!missing) await Bun.write(external, content)
              await Bun.write(recovery, journalContent)
            })
            yield* test.start({
              ...test.host,
              location: {
                ...test.host.location,
                directory: AbsolutePath.make(project),
                project: { ...test.host.location.project, directory: AbsolutePath.make(project) },
              },
            })
            for (const retargeted of [false, true]) {
              if (retargeted) {
                yield* Effect.promise(async () => {
                  await fs.unlink(config)
                  await fs.symlink(external, config)
                })
              }
              for (const method of ["preview", "installed", "install", "uninstall"] as const) {
                expect(
                  yield* test.rpc
                    .call("kilocode.marketplace", method, method === "installed" ? {} : { ...input, scope: "project" })
                    .pipe(Effect.flip),
                ).toMatchObject({
                  type: "fetch_failed",
                  message: expect.stringContaining("no machine-local ownership"),
                })
                expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${project}`)).toBeUndefined()
                expect(yield* test.host.storage.get(`installed:kilo:mcp:demo:project:${source}`)).toBeUndefined()
                expect(yield* Effect.promise(() => Bun.file(recovery).text())).toBe(journalContent)
                if (missing) expect(yield* Effect.promise(() => Bun.file(external).exists())).toBe(false)
                if (!missing) expect(yield* Effect.promise(() => Bun.file(external).text())).toBe(content)
              }
            }
          }),
      )
    }
  }
}

for (const field of ["resources", "pending"] as const) {
  for (const internal of [false, true]) {
    ;(process.platform === "win32" ? it.live.skip : it.live)(
      `uses machine-local ${field} fingerprints when a trusted external target's config is ${internal ? "internal" : "external"}`,
      () =>
        Effect.gen(function* () {
          const test = yield* fixture(false, false)
          const project = path.join(test.directory, "project")
          const config = path.join(project, "kilo2.jsonc")
          const external = path.join(yield* Effect.promise(() => fs.realpath(test.directory)), "dotfiles.jsonc")
          const content = '{"mcp":{"servers":{"demo":{"type":"remote","url":"https://owned.example/mcp"}}}}'
          const modified = content.replace("owned.example", "edited.example")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await Bun.write(external, content)
            if (internal) await Bun.write(config, "{}")
            if (!internal) await fs.symlink(external, config)
          })
          const fingerprint = yield* Effect.promise(() =>
            Installer.resourceFingerprint({ config: external, server: "demo" }),
          )
          const resource = { config, server: "demo", target: external, fingerprints: [fingerprint!] }
          const record = {
            ...input,
            scope: "project" as const,
            project,
            config,
            server: "demo",
            paths: [],
            resources: field === "resources" ? [resource] : [],
            pending: field === "pending" ? [resource] : undefined,
            installedAt: 0,
          }
          yield* test.host.storage.set(`installed:kilo:mcp:demo:project:${project}`, JSON.stringify(record))
          yield* Effect.promise(() => Bun.write(external, modified))
          const forged = yield* Effect.promise(() =>
            Installer.resourceFingerprint({ config: external, server: "demo" }),
          )
          yield* Effect.promise(() =>
            Bun.write(
              journal(path.join(project, ".kilo2")),
              JSON.stringify({
                directory: project,
                record: { ...record, [field]: [{ ...resource, fingerprints: [forged] }] },
              }),
            ),
          )
          yield* test.start({
            ...test.host,
            location: {
              ...test.host.location,
              directory: AbsolutePath.make(project),
              project: { ...test.host.location.project, directory: AbsolutePath.make(project) },
            },
          })
          const listed = decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))
          expect(listed).toHaveLength(1)
          expect(listed[0]).toMatchObject({
            [field]: record[field],
          })
          expect(listed[0].status).not.toBe("ready")
          for (const method of ["install", "uninstall"] as const) {
            expect(
              yield* test.rpc.call("kilocode.marketplace", method, { ...input, scope: "project" }).pipe(Effect.flip),
            ).toMatchObject({ type: "conflict" })
            expect(yield* Effect.promise(() => Bun.file(external).text())).toBe(modified)
            if (internal) expect(yield* Effect.promise(() => Bun.file(config).text())).toBe("{}")
          }
        }),
    )
  }
}

for (const trusted of [false, true]) {
  ;(process.platform === "win32" ? it.live.skip : it.live)(
    `${trusted ? "preserves deliberately installed" : "rejects forged journal authority for"} external config symlinks`,
    () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const project = path.join(test.directory, "project")
        const config = path.join(project, "kilo2.jsonc")
        const external = path.join(test.directory, "dotfiles.jsonc")
        const projectInput = { ...input, scope: "project" } as const
        const projectKey = `installed:kilo:mcp:demo:project:${project}`
        const content = '{"mcp":{"servers":{"demo":{"type":"remote","url":"https://new.example.com/mcp"}}}}'
        yield* Effect.promise(async () => {
          await fs.mkdir(project)
          await Bun.write(external, content)
          await fs.symlink(external, config)
        })
        yield* test.start({
          ...test.host,
          location: {
            ...test.host.location,
            directory: AbsolutePath.make(project),
            project: { ...test.host.location.project, directory: AbsolutePath.make(project) },
          },
        })
        if (!trusted) {
          const fingerprint = yield* Effect.promise(() => Installer.resourceFingerprint({ config, server: "demo" }))
          yield* Effect.promise(() =>
            Bun.write(
              journal(path.join(project, ".kilo2")),
              JSON.stringify({
                directory: project,
                record: {
                  ...projectInput,
                  project,
                  installedAt: 0,
                  paths: [],
                  config,
                  server: "demo",
                  resources: [{ config, server: "demo", target: external, fingerprints: [fingerprint] }],
                },
              }),
            ),
          )
          for (const method of ["installed", "install", "uninstall"] as const) {
            expect(
              yield* test.rpc
                .call("kilocode.marketplace", method, method === "installed" ? {} : projectInput)
                .pipe(Effect.flip),
            ).toMatchObject({ type: "fetch_failed", message: expect.stringContaining("no machine-local ownership") })
            expect(yield* Effect.promise(() => Bun.file(external).text())).toBe(content)
          }
          return
        }
        // Existing machine-local ownership authorizes a dotfiles target; a repository journal alone never does.
        const prior = {
          ...projectInput,
          project,
          installedAt: 0,
          paths: [],
          config,
          server: "demo",
          resources: [
            {
              config,
              server: "demo",
              target: yield* Effect.promise(() => fs.realpath(external)),
              fingerprints: [(yield* Effect.promise(() => Installer.resourceFingerprint({ config, server: "demo" })))!],
            },
          ],
        }
        yield* test.host.storage.set(projectKey, JSON.stringify(prior))
        yield* Effect.promise(() =>
          Bun.write(journal(path.join(project, ".kilo2")), JSON.stringify({ directory: project, record: prior })),
        )
        const installed = decode(yield* test.rpc.call("kilocode.marketplace", "install", projectInput))
        expect(installed.resources).toContainEqual(
          expect.objectContaining({ config, target: yield* Effect.promise(() => fs.realpath(external)) }),
        )
        expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))).toEqual([installed])
        const record = yield* test.host.storage.get(projectKey)
        if (record === undefined) throw new Error("Expected machine-local installation ownership")
        yield* test.host.storage.remove(projectKey)
        expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", projectInput).pipe(Effect.flip)).toMatchObject(
          { type: "fetch_failed", message: expect.stringContaining("no machine-local ownership") },
        )
        yield* test.host.storage.set(projectKey, record)
        const changed = path.join(test.directory, "other-config.jsonc")
        yield* Effect.promise(async () => {
          await Bun.write(changed, content)
          await fs.unlink(config)
          await fs.symlink(changed, config)
        })
        expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", projectInput).pipe(Effect.flip)).toMatchObject(
          { type: "fetch_failed", message: expect.stringContaining("no machine-local ownership") },
        )
        expect(yield* Effect.promise(() => Bun.file(changed).text())).toBe(content)
        yield* Effect.promise(async () => {
          await fs.unlink(config)
          await fs.symlink(external, config)
        })
        yield* test.rpc.call("kilocode.marketplace", "uninstall", projectInput)
        expect(yield* Effect.promise(() => fs.readlink(config))).toBe(external)
        expect(yield* Effect.promise(() => Bun.file(external).json())).toEqual({ mcp: { servers: {} } })
      }),
  )
}

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
    const input = { registry: "kilo", kind: "mcp", id: "demo", scope: "project" } as const
    const key = `installed:kilo:mcp:demo:project:${test.directory}`
    const root = path.join(test.directory, ".kilo2")
    const old = path.join(test.directory, "kilo2.jsonc")
    const unreadable = path.join(test.directory, "kilo2.json")
    const obsolete = path.join(root, "skills", "obsolete")
    const guide = path.join(root, "skills", "guide")
    const config = path.join(root, "kilo2.jsonc")
    const legacy = JSON.stringify({ mcp: { servers: { legacy: { type: "remote", url: "https://legacy" } } } })
    const previous = JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://old" } } } })
    yield* Effect.promise(async () => {
      await Bun.write(old, previous)
      await Bun.write(unreadable, legacy)
      await fs.mkdir(obsolete, { recursive: true })
      await Bun.write(path.join(obsolete, "SKILL.md"), "obsolete guide")
      await Bun.write(config, "{}")
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
        project: test.directory,
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
                // The durable intent owns both old and planned resources before targets are written.
                expect(record).toMatchObject({
                  config,
                  paths: [guide],
                  recovering: true,
                  pending: owned,
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

    const first = decode(yield* test.rpc.call("kilocode.marketplace", "install", input))
    expect(first.pending).toEqual([owned[1], owned[2]])
    expect(first.warnings?.join(" ")).toContain("cleanup")
    expect(decodeList(yield* test.rpc.call("kilocode.marketplace", "installed", {}))[0].warnings?.join(" ")).toContain(
      "cleanup",
    )
    expect(snapshots).toHaveLength(3)
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: first.pending })
    expect(yield* Effect.promise(() => fs.readdir(path.join(root, "skills")))).toEqual(["guide"])

    // Uninstall may remove active resources, but a failed pending read must keep the manifest for retry.
    expect(yield* test.rpc.call("kilocode.marketplace", "uninstall", input).pipe(Effect.flip)).toMatchObject({
      type: "invalid_params",
      message: expect.stringContaining("not valid JSON"),
    })
    expect(decode(JSON.parse(String(yield* test.host.storage.get(key))))).toMatchObject({ pending: first.pending })
    expect(yield* Effect.promise(() => Bun.file(path.join(guide, "SKILL.md")).exists())).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(config).json())).toEqual({ mcp: { servers: {} } })
    expect(yield* Effect.promise(() => Bun.file(journal(root)).exists())).toBe(true)
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
    expect(yield* Effect.promise(() => fs.readdir(path.join(root, "skills")))).toEqual([])
  }),
)
