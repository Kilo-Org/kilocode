import { expect } from "bun:test"
import os from "os"
import path from "path"
import { Auth } from "@/auth"
import { remove } from "@/kilocode/auth/remove"
import { set } from "@/kilocode/auth/set"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { CredentialTable } from "@opencode-ai/core/credential/sql"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const file = path.join(Global.Path.data, "auth.json")
const environment = (content?: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.KILO_AUTH_CONTENT
      if (content === undefined) delete process.env.KILO_AUTH_CONTENT
      else process.env.KILO_AUTH_CONTENT = content
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.KILO_AUTH_CONTENT
        else process.env.KILO_AUTH_CONTENT = previous
      }),
  )

const global = Layer.effect(
  Global.Service,
  Effect.gen(function* () {
    yield* environment()
    expect(Global.Path.data).toBe(path.join(os.tmpdir(), `opencode-test-data-${process.pid}`, "share", "kilo"))
    const fs = yield* FSUtil.Service
    const previous = yield* fs
      .readFileString(file)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
    yield* Effect.addFinalizer(() =>
      (previous === undefined ? fs.remove(file, { force: true }) : fs.writeFileString(file, previous)).pipe(
        Effect.orDie,
      ),
    )
    yield* fs.writeJson(file, {})
    return Global.make({ data: Global.Path.data })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

const dependencies = Layer.mergeAll(Database.layerFromPath(":memory:"), FSUtil.defaultLayer, global, Auth.defaultLayer)
const it = testEffect(Credential.layer.pipe(Layer.provideMerge(dependencies)))

it.live("API key remove and re-add keep the same service and auth.json in sync", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const auth = yield* Auth.Service
    const fs = yield* FSUtil.Service
    const integration = Integration.ID.make("minimax-coding-plan")
    const unrelated = { type: "api", key: "unrelated" }
    yield* fs.writeJson(file, { other: unrelated })

    yield* set("minimax-coding-plan///", new Auth.Api({ type: "api", key: "old" }))
    const current = (yield* credentials.list(integration)).at(-1)!
    expect(current.value).toEqual(Credential.Key.make({ type: "key", key: "old" }))
    expect(yield* fs.readJson(file)).toEqual({ other: unrelated, [integration]: { type: "api", key: "old" } })

    yield* remove("minimax-coding-plan")
    expect(yield* credentials.list(integration)).toEqual([])
    expect(yield* auth.get(integration)).toBeUndefined()
    expect(yield* fs.readJson(file)).toEqual({ other: unrelated })

    const info = new Auth.Api({ type: "api", key: "new", metadata: { resourceName: "resource" } })
    yield* set("minimax-coding-plan/", info)
    const stored = yield* credentials.list(integration)
    expect(stored).toHaveLength(1)
    expect(stored.at(-1)?.value).toEqual(Credential.Key.make({ type: "key", key: "new", metadata: info.metadata }))
    expect(yield* auth.get(integration)).toEqual(info)
    expect(yield* fs.readJson(file)).toEqual({ other: unrelated, [integration]: info })
  }),
)

it.live("overwriting the active credential preserves its ID, label, and inactive imported accounts", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const database = yield* Database.Service
    const fs = yield* FSUtil.Service
    const integration = Integration.ID.make("minimax-coding-plan")
    yield* database.db.insert(CredentialTable).values(
      ["Inactive", "Active"].map((label, index) => ({
        id: Credential.ID.create(),
        integration_id: integration,
        label,
        value: Credential.Key.make({ type: "key", key: label }),
        time_created: index + 1,
        time_updated: index + 1,
      })),
    )
    const before = yield* credentials.list(integration)
    const info = new Auth.Api({ type: "api", key: "replacement" })
    yield* fs.writeJson(file, { [integration + "/"]: { type: "api", key: "stale" } })

    yield* set("minimax-coding-plan/", info)

    const after = yield* credentials.list(integration)
    expect(after).toHaveLength(2)
    expect(after.at(0)).toEqual(before.at(0))
    expect(after.at(-1)).toMatchObject({
      id: before.at(-1)!.id,
      label: "Active",
      value: { type: "key", key: "replacement" },
    })
    expect(yield* fs.readJson(file)).toEqual({ [integration]: info })
  }),
)

it.live("OAuth saves map account metadata and round-trip through auth.json", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const fs = yield* FSUtil.Service
    const info = new Auth.Oauth({
      type: "oauth",
      refresh: "refresh",
      access: "access",
      expires: 123,
      accountId: "account",
      enterpriseUrl: "https://enterprise.example.com",
    })
    for (const name of ["openai", "github-copilot"]) {
      const integration = Integration.ID.make(name)
      yield* set(name + "/", info)
      const stored = yield* credentials.list(integration)
      expect(stored).toHaveLength(1)
      expect(stored.at(-1)?.value).toEqual(
        Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make(name === "openai" ? "chatgpt-browser" : "oauth"),
          refresh: "refresh",
          access: "access",
          expires: 123,
          metadata: { accountID: "account", enterpriseURL: "https://enterprise.example.com" },
        }),
      )
    }
    expect(yield* fs.readJson(file)).toEqual({ openai: info, "github-copilot": info })
  }),
)

it.live("wellknown saves delegate to Auth without changing credentials", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const auth = yield* Auth.Service
    const fs = yield* FSUtil.Service
    const integration = Integration.ID.make("corp")
    const current = yield* credentials.create({
      integrationID: integration,
      label: "Existing",
      value: Credential.Key.make({ type: "key", key: "existing" }),
    })
    const info = new Auth.WellKnown({ type: "wellknown", key: "TOKEN", token: "token" })

    yield* set("corp/", info)
    yield* set("new/", info)

    expect(yield* credentials.all()).toEqual([current])
    expect(yield* auth.get("corp")).toEqual(info)
    expect(yield* fs.readJson(file)).toEqual({ corp: info, new: info })
  }),
)

it.live("injected credential updates and creates leave host DB and auth.json untouched", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const database = yield* Database.Service
    const fs = yield* FSUtil.Service
    const integration = Integration.ID.make("openai")
    yield* credentials.create({
      integrationID: integration,
      label: "Host",
      value: Credential.Key.make({ type: "key", key: "host" }),
    })
    const rows = yield* database.db.select().from(CredentialTable).all()
    const content = yield* fs.readFileString(file)
    yield* environment(JSON.stringify({ openai: { type: "api", key: "injected" } }))

    yield* Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const current = (yield* credentials.list(integration)).at(-1)!
      expect(current.value).toEqual(Credential.Key.make({ type: "key", key: "injected" }))
      yield* set("openai/", new Auth.Api({ type: "api", key: "updated" }))
      expect(yield* credentials.list(integration)).toEqual([
        new Credential.Info({
          id: current.id,
          integrationID: integration,
          label: current.label,
          value: Credential.Key.make({ type: "key", key: "updated" }),
        }),
      ])
      yield* credentials.remove(current.id)
      yield* set("openai", new Auth.Api({ type: "api", key: "re-added" }))
      expect((yield* credentials.list(integration)).at(-1)?.value).toEqual(
        Credential.Key.make({ type: "key", key: "re-added" }),
      )
    }).pipe(Effect.provide(Credential.layer.pipe(Layer.fresh)))

    expect(yield* database.db.select().from(CredentialTable).all()).toEqual(rows)
    expect(yield* fs.readFileString(file)).toBe(content)
  }),
)
