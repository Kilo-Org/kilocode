import { expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloPrivacyRpc } from "@opencode/schema/kilocode/privacy"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.settings RPC through the real host and the generated client, with real global and project kilo2.json
// files. The settings plugin resolves the write target with KiloConfigWriter, so the round trip, the revision
// conflict, the project-wide unset, and the watcher-driven reload all run against the real files.

type Files = { global?: unknown; project?: unknown; projectDir?: unknown }
type Paths = { directory: string; global: string }

const boot =
  (files: Files, body: (client: Client, paths: Paths) => Promise<void>, options: { filewatcher?: boolean } = {}) =>
  async () => {
    using backend = fixture()
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-settings-rpc-")))
    const directory = path.join(root, "repo")
    const global = path.join(root, "global")
    await $`git init -q -b main ${directory}`.quiet()
    if (files.global !== undefined) {
      await mkdir(global, { recursive: true })
      await Bun.write(path.join(global, "kilo2.json"), JSON.stringify(files.global))
    }
    if (files.project !== undefined)
      await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify(files.project))
    if (files.projectDir !== undefined) {
      await mkdir(path.join(directory, ".kilo2"), { recursive: true })
      await Bun.write(path.join(directory, ".kilo2", "kilo2.json"), JSON.stringify(files.projectDir))
    }
    const previous = { KILO_API_URL: process.env.KILO_API_URL, KILO_API_KEY: process.env.KILO_API_KEY }
    process.env.KILO_API_URL = backend.url
    delete process.env.KILO_API_KEY
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: options.filewatcher ?? false },
                  config: { directory: global, project: true },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })
            yield* Effect.promise(() => body(client, { directory, global }))
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
      )
    } finally {
      Object.entries(previous).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      await rm(root, { recursive: true, force: true })
    }
  }

type Client = ReturnType<typeof OpenCode.make>

const rpc = (client: Client) => client.rpc(KiloSettingsRpc.Definition)
const settingsTarget = (client: Client, directory: string, scope: KiloSettingsRpc.Scope) =>
  rpc(client).target({ scope }, { location: { directory } })
const settingsWrite = (client: Client, directory: string, input: Parameters<ReturnType<typeof rpc>["write"]>[0]) =>
  rpc(client).write(input, { location: { directory } })
const privacy = (client: Client, directory: string) =>
  client.rpc(KiloPrivacyRpc.Definition).get({}, { location: { directory } })

const waitFor = async (predicate: () => boolean, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return true
    await Bun.sleep(25)
  }
  return predicate()
}

test(
  "target resolves the created global file and write sets a key in it",
  boot({}, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    expect(await settingsTarget(client, directory, "global")).toEqual({
      scope: "global",
      path: file,
      exists: false,
    })
    const result = await settingsWrite(client, directory, { scope: "global", set: { privacy_mode: true } })
    expect(result.changed).toBe(true)
    expect(result.target).toMatchObject({ scope: "global", path: file, exists: true })
    expect(typeof result.target.revision).toBe("string")
    expect(await Bun.file(file).text()).toBe('{\n  "privacy_mode": true\n}\n')
  }),
  30_000,
)

test(
  "a stale revision fails with a structured conflict and the current target",
  boot({ global: { privacy_mode: true } }, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    const before = await settingsTarget(client, directory, "global")
    expect(before.exists).toBe(true)
    await Bun.write(file, JSON.stringify({ privacy_mode: false, shell: "sh" }))
    const failure = await settingsWrite(client, directory, {
      scope: "global",
      set: { privacy_mode: true },
      expected: { path: before.path, revision: before.revision! },
    }).then(
      () => undefined,
      (error: unknown) => error as { type: string; data: { code: string; target: { exists: boolean } } },
    )
    expect(failure?.type).toBe("conflict")
    expect(failure?.data.code).toBe("revision-conflict")
    expect(failure?.data.target.exists).toBe(true)
    // The guarded write did not overwrite the newer file.
    expect(JSON.parse(await Bun.file(file).text())).toEqual({ privacy_mode: false, shell: "sh" })
  }),
  30_000,
)

test(
  "a changed target fails with target-changed",
  boot({ global: { privacy_mode: true } }, async (client, { directory }) => {
    const failure = await settingsWrite(client, directory, {
      scope: "global",
      set: { privacy_mode: true },
      expected: { path: path.join(directory, "kilo2.json"), revision: "deadbeef" },
    }).then(
      () => undefined,
      (error: unknown) => error as { type: string; data: { code: string } },
    )
    expect(failure?.type).toBe("conflict")
    expect(failure?.data.code).toBe("target-changed")
  }),
  30_000,
)

test(
  "a project unset removes the key from every project document that sets it",
  boot(
    { project: { privacy_mode: true }, projectDir: { privacy_mode: true } },
    async (client, { directory }) => {
      const result = await settingsWrite(client, directory, { scope: "project", unset: [["privacy_mode"]] })
      expect(result.changed).toBe(true)
      expect(JSON.parse(await Bun.file(path.join(directory, ".kilo2", "kilo2.json")).text())).toEqual({})
      expect(JSON.parse(await Bun.file(path.join(directory, "kilo2.json")).text())).toEqual({})
    },
  ),
  30_000,
)

test(
  "a write preserves the target's comments and 0600 mode",
  boot({ global: { privacy_mode: true } }, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    await Bun.write(file, '{\n  // keep this comment\n  "privacy_mode": false\n}\n')
    await settingsWrite(client, directory, { scope: "global", set: { privacy_mode: true } })
    const text = await Bun.file(file).text()
    expect(text).toContain("// keep this comment")
    expect(JSON.parse(text.replace("// keep this comment", ""))).toEqual({ privacy_mode: true })
    const mode = (await Bun.file(file).stat()).mode & 0o777
    expect(mode).toBe(0o600)
  }),
  30_000,
)

test(
  "the config watcher reloads after a write, so the change is live without a restart",
  boot(
    { global: { privacy_mode: false } },
    async (client, { directory }) => {
      const seen: string[] = []
      const controller = new AbortController()
      const subscription = (async () => {
        for await (const event of client.event.subscribe({ signal: controller.signal }))
          seen.push((event as { type: string }).type)
      })()
      try {
        await settingsWrite(client, directory, { scope: "global", set: { privacy_mode: true } })
        expect(await waitFor(() => seen.includes("config.updated"))).toBe(true)
        expect(await privacy(client, directory)).toEqual({ enabled: true })
      } finally {
        controller.abort()
        await subscription.catch(() => undefined)
      }
    },
    { filewatcher: true },
  ),
  30_000,
)
