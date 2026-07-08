import path from "node:path"
import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { applyEdits, modify } from "jsonc-parser"
import { Marketplace } from "@/kilocode/marketplace"
import { CatalogSource } from "@/kilocode/stack/catalog/source"
import { StackRuntime } from "@/kilocode/stack/runtime"
import { Stack } from "@/kilocode/stack/schema"
import { StackService } from "@/kilocode/stack/service"
import { StackStore } from "@/kilocode/stack/store"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { skillArchive } from "../marketplace/fixture"

const base = Layer.mergeAll(
  StackRuntime.defaultLayer,
  StackStore.defaultLayer,
  AppFileSystem.defaultLayer,
  EffectFlock.defaultLayer,
)
const it = testEffect(base)
const endpoint = "https://marketplace.example.com/stack.json"
const artifact = "https://marketplace.example.com/dbt-analytics-engineering.tar.gz"
const skill = "dbt-analytics-engineering"
const skillRef = Stack.ResourceRef.make(`skill:${skill}`)
const mcpRef = Stack.ResourceRef.make("mcp:dbt")

function http(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  return HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
}

function fixture(bytes: Uint8Array) {
  return {
    version: 1,
    revision: "2026-06-22.1",
    items: [
      {
        kind: "skill",
        id: skill,
        version: "1.0.0",
        source_revision: "a".repeat(40),
        name: "dbt Analytics Engineering",
        description: "A fixture dbt Skill",
        publisher: { id: "dbt", name: "dbt Labs", trust: "first-party" },
        maturity: "stable",
        support: "publisher",
        source_url: "https://github.com/dbt-labs/dbt-agent-skills",
        installability: { installable: true },
        tags: ["data"],
        artifact: {
          url: artifact,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          size: bytes.byteLength,
          format: "tar.gz",
        },
      },
      {
        kind: "mcp",
        id: "dbt",
        version: "2.0.0",
        source_revision: "b".repeat(40),
        name: "dbt MCP",
        description: "A fixture dbt MCP",
        publisher: { id: "dbt", name: "dbt Labs", trust: "first-party" },
        maturity: "stable",
        support: "publisher",
        source_url: "https://github.com/dbt-labs/dbt-mcp",
        installability: { installable: true },
        tags: ["data"],
        methods: [
          {
            id: "local",
            name: "Local",
            template: {
              type: "local",
              command: ["dbt-mcp", "--project-dir", "{param:project_dir}"],
              environment: { DBT_TOKEN: "{env:DBT_TOKEN}" },
              enabled: false,
            },
            parameters: [
              {
                id: "project_dir",
                name: "Project directory",
                type: "path",
                required: true,
                sensitive: false,
              },
              {
                id: "token",
                name: "Token",
                type: "string",
                required: true,
                sensitive: true,
                environment: "DBT_TOKEN",
              },
            ],
            prerequisites: ["Install dbt-mcp."],
            platforms: ["darwin", "linux", "win32"],
            auth: { mode: "environment", environment: ["DBT_TOKEN"] },
            warnings: { writes: false },
          },
        ],
      },
    ],
  }
}

function client(bytes: Uint8Array) {
  const manifest = fixture(bytes)
  return http((request) => {
    if (request.url === artifact) {
      const body = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(body).set(bytes)
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/gzip", "content-length": String(bytes.byteLength) },
      })
    }
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
}

function layer(cache: string, value: HttpClient.HttpClient) {
  const market = Marketplace.layer({ endpoint, cacheDir: cache }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, value)),
  )
  return StackService.layer.pipe(
    Layer.provide(CatalogSource.snapshotLayer),
    Layer.provide(market),
  )
}

function selected(root = ".") {
  return Schema.decodeUnknownSync(Stack.Draft)({
    verticals: { data: { technologies: ["dbt"] } },
    resources: {
      [mcpRef]: { enabled: true, method: "local", parameters: { project_dir: root } },
    },
  })
}

function empty() {
  return Schema.decodeUnknownSync(Stack.Draft)({
    verticals: { data: { technologies: [] } },
    resources: {},
  })
}

function apply(service: StackService.Interface, draft: Stack.Draft) {
  return Effect.gen(function* () {
    const plan = yield* service.preview(draft)
    return yield* service.apply(plan.draft, plan.plan_hash)
  })
}

function target(dir: string) {
  return path.join(dir, ".kilo", "kilo.jsonc")
}

function destination(dir: string) {
  return path.join(dir, ".kilo", "skills", skill)
}

function toggle(source: string, enabled: boolean) {
  const edits = modify(source, ["mcp", "dbt", "enabled"], enabled, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  return applyEdits(source, edits)
}

describe("Stack orchestration service", () => {
  it.instance(
    "applies a Skill and enabled MCP with exact receipts and refreshed state",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const catalog = yield* service.catalog()
          expect(catalog.resources.find((entry) => entry.resource.ref === skillRef)?.availability).toBe("available")
          expect(catalog.resources.find((entry) => entry.resource.ref === mcpRef)?.availability).toBe("available")
          expect(catalog.resources.some((entry) => entry.availability === "missing")).toBe(true)

          const plan = yield* service.preview(selected())
          expect(Object.fromEntries(plan.actions.map((action) => [action.resource, action.action]))).toMatchObject({
            [skillRef]: "install",
            [mcpRef]: "install",
          })
          const response = yield* service.apply(plan.draft, plan.plan_hash)
          expect(response.results.every((entry) => entry.success)).toBe(true)
          expect(yield* fs.isFile(path.join(destination(test.directory), "SKILL.md"))).toBe(true)

          const store = yield* StackStore.Service
          const current = yield* store.read()
          expect(current.mcp.dbt).toEqual({
            type: "local",
            command: ["dbt-mcp", "--project-dir", "."],
            environment: { DBT_TOKEN: "{env:DBT_TOKEN}" },
            enabled: true,
          })
          expect(current.raw).not.toContain("secret")
          expect(current.stack?.resources[mcpRef]?.enabled).toBe(true)
          expect(current.stack?.managed[skillRef]).toMatchObject({ marketplace_id: skill, version: "1.0.0" })
          expect(current.stack?.managed[mcpRef]).toMatchObject({ marketplace_id: "dbt", version: "2.0.0" })
          expect(response.state.resources.find((entry) => entry.resource === skillRef)).toMatchObject({
            managed: true,
            drift: "none",
          })
          expect((yield* service.get()).config_revision).toBe(current.revision)
        }).pipe(Effect.provide(layer(cache, client(bytes))))
      }),
    { git: true },
  )

  it.instance(
    "tolerates unavailable Marketplace during preview and cancel writes nothing",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const unavailable = http(() => new Response("unavailable", { status: 503 }))

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(selected())
          expect(plan.actions.find((action) => action.resource === skillRef)?.action).toBe("blocked")
          expect(plan.conflicts.map((conflict) => conflict.code)).toContain("marketplace_unavailable")
          const raw = Schema.decodeUnknownSync(Stack.Draft)({
            ...selected(),
            resources: {
              ...selected().resources,
              [mcpRef]: {
                enabled: true,
                method: "local",
                parameters: { workspace: "innocent-key-raw-secret" },
              },
            },
          })
          const redacted = yield* service.preview(raw)
          expect(redacted.draft.resources[mcpRef]).toEqual({ enabled: true })
          expect(JSON.stringify(redacted)).not.toContain("raw-secret")
          expect((yield* Effect.flip(service.catalog()))._tag).toBe("StackMarketplaceUnavailableError")
          expect((yield* Effect.flip(service.get()))._tag).toBe("StackMarketplaceUnavailableError")
        }).pipe(Effect.provide(layer(cache, unavailable)))

        expect(yield* fs.existsSafe(target(test.directory))).toBe(false)
        expect(yield* fs.existsSafe(path.join(test.directory, ".kilo", "skills"))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "redacts disabled sensitive overrides without persisting raw values",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        const value = Schema.decodeUnknownSync(Stack.Draft)({
          verticals: { data: { technologies: ["dbt"] } },
          resources: {
            [skillRef]: { enabled: false },
            [mcpRef]: { enabled: false, method: "local", parameters: { token: "raw-secret" } },
          },
        })

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(value)
          expect(plan.conflicts.map((conflict) => conflict.code)).toContain("invalid_draft")
          expect(plan.draft.resources[mcpRef]).toEqual({ enabled: false })
          expect(JSON.stringify(plan)).not.toContain("raw-secret")
          const error = yield* Effect.flip(service.apply(plan.draft, plan.plan_hash))
          expect(error._tag).toBe("StackStalePlanError")
        }).pipe(Effect.provide(layer(cache, client(bytes))))

        expect(yield* fs.existsSafe(target(test.directory))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "maps invalid exact-target MCP config to invalid-config",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        yield* fs.writeWithDirs(
          target(test.directory),
          '{ "mcp": { "dbt": { "type": "local", "command": ["dbt"], "unsupported": true } } }\n',
        )

        const error = yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          return yield* Effect.flip(service.preview(empty()))
        }).pipe(Effect.provide(layer(cache, client(bytes))))
        expect(error._tag).toBe("StackInvalidConfigError")
      }),
    { git: true },
  )

  it.instance(
    "applies preservation and relinquishment while Marketplace is unavailable",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const bytes = skillArchive(skill)
        const initial = yield* fs.makeTempDirectoryScoped()
        yield* StackService.Service.use((service) => apply(service, selected())).pipe(
          Effect.provide(layer(initial, client(bytes))),
        )
        const file = path.join(destination(test.directory), "SKILL.md")
        yield* fs.writeFileString(file, `${yield* fs.readFileString(file)}\nUser change.\n`)

        const cache = yield* fs.makeTempDirectoryScoped()
        const unavailable = http(() => new Response("unavailable", { status: 503 }))
        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(empty())
          expect(plan.actions.find((action) => action.resource === skillRef)?.action).toBe("relinquish_modified")
          expect(plan.conflicts.map((conflict) => conflict.code)).toContain("marketplace_unavailable")
          const response = yield* service.apply(plan.draft, plan.plan_hash)
          expect(response.results.every((result) => result.success)).toBe(true)
        }).pipe(Effect.provide(layer(cache, unavailable)))

        const current = yield* StackStore.Service.use((store) => store.read())
        expect(current.stack?.managed).toEqual({})
        expect(yield* fs.readFileString(file)).toContain("User change.")
      }),
    { git: true },
  )

  it.instance(
    "removes only unchanged managed resources for zero selections",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        const file = target(test.directory)
        const user = path.join(test.directory, ".kilo", "skills", "user-skill", "SKILL.md")
        yield* fs.writeWithDirs(
          file,
          '{\n  "mcp": {\n    "user-mcp": { "type": "remote", "url": "https://user.example.com", "enabled": true }\n  }\n}\n',
        )
        yield* fs.writeWithDirs(user, "---\nname: user-skill\n---\n\nKeep me.\n")

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          yield* apply(service, selected())
          const plan = yield* service.preview(empty())
          expect(Object.fromEntries(plan.actions.map((action) => [action.resource, action.action]))).toMatchObject({
            [skillRef]: "remove",
            [mcpRef]: "remove",
          })
          yield* service.apply(plan.draft, plan.plan_hash)
        }).pipe(Effect.provide(layer(cache, client(bytes))))

        const current = yield* StackStore.Service.use((store) => store.read())
        expect(current.stack?.managed).toEqual({})
        expect(current.mcp["user-mcp"]).toEqual({
          type: "remote",
          url: "https://user.example.com",
          enabled: true,
        })
        expect(current.mcp.dbt).toBeUndefined()
        expect(yield* fs.isFile(user)).toBe(true)
        expect(yield* fs.existsSafe(destination(test.directory))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "preserves explicit MCP disablement during managed reconfiguration",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          yield* apply(service, selected())
          const config = yield* fs.readFileString(target(test.directory))
          yield* fs.writeFileString(target(test.directory), toggle(config, false))

          const changed = selected("warehouse")
          const plan = yield* service.preview(changed)
          expect(plan.actions.find((action) => action.resource === mcpRef)?.action).toBe("install")
          yield* service.apply(plan.draft, plan.plan_hash)
        }).pipe(Effect.provide(layer(cache, client(bytes))))

        const current = yield* StackStore.Service.use((store) => store.read())
        expect(current.mcp.dbt).toMatchObject({
          command: ["dbt-mcp", "--project-dir", "warehouse"],
          enabled: false,
        })
        expect(current.stack?.resources[mcpRef]?.enabled).toBe(true)
        expect(current.stack?.managed[mcpRef]).toBeDefined()
      }),
    { git: true },
  )

  it.instance(
    "preserves modified managed resources and relinquishes their receipts",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          yield* apply(service, selected())
          const file = path.join(destination(test.directory), "SKILL.md")
          yield* fs.writeFileString(file, `${yield* fs.readFileString(file)}\nUser change.\n`)
          const config = yield* fs.readFileString(target(test.directory))
          const disabled = toggle(config, false)
          yield* fs.writeFileString(target(test.directory), disabled)
          const kept = yield* service.preview(selected())
          expect(kept.actions.find((action) => action.resource === mcpRef)?.action).toBe("keep")
          yield* fs.writeFileString(target(test.directory), disabled.replace('"dbt-mcp"', '"custom-dbt-mcp"'))

          const plan = yield* service.preview(empty())
          expect(Object.fromEntries(plan.actions.map((action) => [action.resource, action.action]))).toMatchObject({
            [skillRef]: "relinquish_modified",
            [mcpRef]: "relinquish_modified",
          })
          yield* service.apply(plan.draft, plan.plan_hash)
        }).pipe(Effect.provide(layer(cache, client(bytes))))

        const current = yield* StackStore.Service.use((store) => store.read())
        expect(current.stack?.managed).toEqual({})
        expect(current.mcp.dbt).toMatchObject({ command: ["custom-dbt-mcp", "--project-dir", "."] })
        expect(yield* fs.readFileString(path.join(destination(test.directory), "SKILL.md"))).toContain("User change.")
      }),
    { git: true },
  )

  it.instance(
    "rejects a stale plan before staging or project writes",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(selected())
          yield* fs.writeWithDirs(target(test.directory), '{\n  "theme": "changed"\n}\n')
          const error = yield* Effect.flip(service.apply(plan.draft, plan.plan_hash))
          expect(error._tag).toBe("StackStalePlanError")
        }).pipe(Effect.provide(layer(cache, client(bytes))))

        expect(yield* fs.readFileString(target(test.directory))).toBe('{\n  "theme": "changed"\n}\n')
        expect(yield* fs.existsSafe(destination(test.directory))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "rolls back skill and config commits when interruption was deferred",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const pausing = Layer.effect(
          StackStore.Service,
          Effect.gen(function* () {
            const store = yield* StackStore.Service
            return StackStore.Service.of({
              ...store,
              commit: (prepared) =>
                Effect.gen(function* () {
                  const committed = yield* store.commit(prepared)
                  yield* Deferred.succeed(entered, undefined)
                  yield* Deferred.await(release)
                  return committed
                }),
            })
          }),
        )
        const serviceLayer = StackService.layer.pipe(
          Layer.provide(CatalogSource.snapshotLayer),
          Layer.provide(pausing),
          Layer.provide(
            Marketplace.layer({ endpoint, cacheDir: cache }).pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient, client(bytes))),
            ),
          ),
        )

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(selected())
          const applied = yield* service.apply(plan.draft, plan.plan_hash).pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          const interrupt = yield* Fiber.interrupt(applied).pipe(Effect.forkChild)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(interrupt)
          const exit = yield* Fiber.await(applied)
          expect(Exit.isFailure(exit)).toBe(true)
        }).pipe(Effect.provide(serviceLayer))

        const current = yield* StackStore.Service.use((store) => store.read())
        expect(current.stack).toBeUndefined()
        expect(current.mcp).toEqual({})
        expect(yield* fs.existsSafe(target(test.directory))).toBe(false)
        expect(yield* fs.existsSafe(destination(test.directory))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "rolls back config and files when verification defects after commit",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        const state = { committed: false }
        const defective = Layer.effect(
          StackStore.Service,
          Effect.gen(function* () {
            const store = yield* StackStore.Service
            return StackStore.Service.of({
              ...store,
              read: () => (state.committed ? Effect.die("verification defect") : store.read()),
              commit: (prepared) =>
                store.commit(prepared).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      state.committed = true
                    }),
                  ),
                ),
              rollback: (committed) =>
                store.rollback(committed).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      state.committed = false
                    }),
                  ),
                ),
            })
          }),
        )
        const serviceLayer = StackService.layer.pipe(
          Layer.provide(CatalogSource.snapshotLayer),
          Layer.provide(defective),
          Layer.provide(
            Marketplace.layer({ endpoint, cacheDir: cache }).pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient, client(bytes))),
            ),
          ),
        )

        const error = yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(selected())
          return yield* Effect.flip(service.apply(plan.draft, plan.plan_hash))
        }).pipe(Effect.provide(serviceLayer))
        expect(error._tag).toBe("StackApplyError")
        if (error._tag === "StackApplyError") expect(error.rollback).toBe(true)
        expect(yield* fs.existsSafe(target(test.directory))).toBe(false)
        expect(yield* fs.existsSafe(destination(test.directory))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "rolls back installed files when the exact config changes during commit",
    () =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const test = yield* TestInstance
        const cache = yield* fs.makeTempDirectoryScoped()
        const bytes = skillArchive(skill)
        const race = '{\n  "theme": "concurrent"\n}\n'
        const flaky = Layer.effect(
          StackStore.Service,
          Effect.gen(function* () {
            const store = yield* StackStore.Service
            const system = yield* AppFileSystem.Service
            return StackStore.Service.of({
              ...store,
              commit: (prepared) =>
                system.writeWithDirs(prepared.path, race).pipe(
                  Effect.mapError(() => new StackStore.FileError({ path: prepared.path, operation: "write" })),
                  Effect.flatMap(() => store.commit(prepared)),
                ),
            })
          }),
        )
        const serviceLayer = StackService.layer.pipe(
          Layer.provide(CatalogSource.snapshotLayer),
          Layer.provide(flaky),
          Layer.provide(
            Marketplace.layer({ endpoint, cacheDir: cache }).pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient, client(bytes))),
            ),
          ),
        )

        yield* Effect.gen(function* () {
          const service = yield* StackService.Service
          const plan = yield* service.preview(selected())
          const error = yield* Effect.flip(service.apply(plan.draft, plan.plan_hash))
          expect(error._tag).toBe("StackApplyError")
          if (error._tag === "StackApplyError") expect(error.rollback).toBe(true)
        }).pipe(Effect.provide(serviceLayer))

        expect(yield* fs.readFileString(target(test.directory))).toBe(race)
        expect(yield* fs.existsSafe(destination(test.directory))).toBe(false)
        expect(
          (yield* fs.readDirectoryEntries(path.join(test.directory, ".kilo"))).some((entry) =>
            entry.name.startsWith(".stack-backup-"),
          ),
        ).toBe(false)
      }),
    { git: true },
  )
})
