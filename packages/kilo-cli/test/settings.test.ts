import { expect, test } from "bun:test"
import { $ } from "bun"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloPrivacyRpc } from "@opencode/schema/kilocode/privacy"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

// The kilocode.settings RPC through the real host and the generated client, with real global and project kilo2.json
// files. The settings plugin resolves each write to the reader's effective document, so the round trip, the revision
// conflict, ancestor precedence, the project-wide unset, the symlink guard, and the watcher-driven reload all run
// against the real files.

type Files = { global?: unknown; project?: unknown; projectDir?: unknown; outside?: unknown }
type FilePaths = { directory: string; repoRoot: string; global: string }
type Paths = FilePaths & {
  /** Raw request for inputs the typed client rejects, such as an empty unset path. */
  request: (url: string, init?: RequestInit) => Promise<Response>
}
type Options = {
  filewatcher?: boolean
  /** Skip `git init` so the location is outside version control and the reader walks to the filesystem root. */
  git?: boolean
  /** Run the server in this subdirectory of the git root, so ancestor project config is in scope. */
  subdirectory?: string
  /** Extra setup after the config files are written, for example a symlinked config directory. */
  setup?: (paths: FilePaths) => Promise<void>
}

const boot =
  (files: Files, body: (client: Client, paths: Paths) => Promise<void>, options: Options = {}) =>
  async () => {
    using backend = fixture()
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-settings-rpc-")))
    const repoRoot = path.join(root, "repo")
    const directory = options.subdirectory ? path.join(repoRoot, options.subdirectory) : repoRoot
    const global = path.join(root, "global")
    if (options.git ?? true) await $`git init -q -b main ${repoRoot}`.quiet()
    else await mkdir(repoRoot, { recursive: true })
    if (files.global !== undefined) {
      await mkdir(global, { recursive: true })
      await Bun.write(path.join(global, "kilo2.json"), JSON.stringify(files.global))
    }
    if (files.project !== undefined) await Bun.write(path.join(repoRoot, "kilo2.json"), JSON.stringify(files.project))
    if (files.projectDir !== undefined) {
      await mkdir(path.join(repoRoot, ".kilo2"), { recursive: true })
      await Bun.write(path.join(repoRoot, ".kilo2", "kilo2.json"), JSON.stringify(files.projectDir))
    }
    // A document above the worktree root: reached only when the reader walks to the filesystem root outside VCS.
    if (files.outside !== undefined) await Bun.write(path.join(root, "kilo2.json"), JSON.stringify(files.outside))
    if (options.subdirectory) await mkdir(directory, { recursive: true })
    const filePaths = { directory, repoRoot, global }
    await options.setup?.(filePaths)
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
            const request = (url: string, init?: RequestInit) => handler(new Request(new URL(url, "http://kilo.local"), init))
            yield* Effect.promise(() => body(client, { ...filePaths, request }))
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
    // Windows has no POSIX mode bits, so the 0600 guarantee is only observable elsewhere.
    if (process.platform !== "win32") {
      const mode = (await Bun.file(file).stat()).mode & 0o777
      expect(mode).toBe(0o600)
    }
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

test(
  "a project write resolves to the reader's highest-precedence document, including an ancestor",
  boot(
    { projectDir: { privacy_mode: true } },
    async (client, { directory, repoRoot }) => {
      const winner = path.join(repoRoot, ".kilo2", "kilo2.json")
      expect(await settingsTarget(client, directory, "project")).toMatchObject({ path: winner, exists: true })
      const result = await settingsWrite(client, directory, { scope: "project", set: { shell: "zsh" } })
      expect(result.changed).toBe(true)
      expect(result.target.path).toBe(winner)
      // The write does not create a lower-precedence file that the reader would ignore.
      expect(await Bun.file(path.join(directory, "kilo2.json")).exists()).toBe(false)
      expect(JSON.parse(await Bun.file(winner).text())).toEqual({ privacy_mode: true, shell: "zsh" })
    },
    { subdirectory: "packages/app" },
  ),
  30_000,
)

test(
  "outside version control a project write reaches config above the worktree root",
  boot(
    { outside: { privacy_mode: true } },
    async (client, { directory, repoRoot }) => {
      const winner = path.join(path.dirname(repoRoot), "kilo2.json")
      expect(await settingsTarget(client, directory, "project")).toMatchObject({ path: winner })
      const result = await settingsWrite(client, directory, { scope: "project", set: { shell: "zsh" } })
      expect(result.target.path).toBe(winner)
      expect(JSON.parse(await Bun.file(winner).text())).toEqual({ privacy_mode: true, shell: "zsh" })
    },
    { subdirectory: "sub", git: false },
  ),
  30_000,
)

test(
  "inside version control a project write ignores config above the worktree root",
  boot(
    { outside: { privacy_mode: true } },
    async (client, { directory, repoRoot }) => {
      const outside = path.join(path.dirname(repoRoot), "kilo2.json")
      const fallback = path.join(directory, "kilo2.json")
      expect(await settingsTarget(client, directory, "project")).toMatchObject({ path: fallback, exists: false })
      const result = await settingsWrite(client, directory, { scope: "project", set: { shell: "zsh" } })
      expect(result.target.path).toBe(fallback)
      // The document above the worktree root is outside the reader's walk and is left alone.
      expect(JSON.parse(await Bun.file(outside).text())).toEqual({ privacy_mode: true })
    },
    { subdirectory: "sub" },
  ),
  30_000,
)

test.skipIf(process.platform === "win32")(
  "a symlinked config directory cannot redirect a project write outside the project",
  boot(
    {},
    async (client, { directory, repoRoot }) => {
      const external = path.join(path.dirname(repoRoot), "external")
      const failure = await settingsWrite(client, directory, { scope: "project", unset: [["privacy_mode"]] }).then(
        () => undefined,
        (error: unknown) => error as { type: string },
      )
      expect(failure?.type).toBe("failed")
      expect(JSON.parse(await Bun.file(path.join(external, "kilo2.json")).text())).toEqual({ privacy_mode: true })
    },
    {
      setup: async ({ repoRoot }) => {
        const external = path.join(path.dirname(repoRoot), "external")
        await mkdir(external, { recursive: true })
        await Bun.write(path.join(external, "kilo2.json"), JSON.stringify({ privacy_mode: true }))
        await symlink(external, path.join(repoRoot, ".kilo2"), "dir")
      },
    },
  ),
  30_000,
)

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => error as { type: string; data: { message: string; path?: string } },
  )

test(
  "an unrecognized key is refused as invalid and the file is left unchanged",
  boot({ global: { shell: "sh" } }, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    const before = await Bun.file(file).text()
    const error = await failure(settingsWrite(client, directory, { scope: "global", set: { bogus: 1, permission: {} } }))
    expect(error?.type).toBe("invalid")
    expect(error?.data).toEqual({ message: "Unrecognized keys: bogus, permission", path: file })
    expect(await Bun.file(file).text()).toBe(before)
  }),
  30_000,
)

test(
  "a value the reader would skip is refused as invalid and the file is left unchanged",
  boot({ global: { shell: "sh" } }, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    const before = await Bun.file(file).text()
    const upstream = await failure(settingsWrite(client, directory, { scope: "global", set: { shell: 5 } }))
    expect(upstream?.type).toBe("invalid")
    expect(upstream?.data.message).toContain("$.shell: skipped malformed recognized value")
    const kilo = await failure(
      settingsWrite(client, directory, { scope: "global", set: { privacy_mode: true, sandbox: { network: "maybe" } } }),
    )
    expect(kilo?.type).toBe("invalid")
    expect(kilo?.data.message).toContain("$.sandbox: ignored invalid sandbox")
    // The valid key in the same request is not written either.
    expect(await Bun.file(file).text()).toBe(before)
  }),
  30_000,
)

test(
  "an object set over a non-object value replaces it, and a removal of an absent path is a no-op",
  boot({ global: { mcp: { servers: "none" }, shell: "sh" } }, async (client, { directory, global }) => {
    const file = path.join(global, "kilo2.json")
    const server = { type: "remote", url: "https://mcp.example.com" }
    const result = await settingsWrite(client, directory, { scope: "global", set: { mcp: { servers: { docs: server } } } })
    expect(result.changed).toBe(true)
    expect(JSON.parse(await Bun.file(file).text())).toEqual({ mcp: { servers: { docs: server } }, shell: "sh" })
    const noop = await settingsWrite(client, directory, { scope: "global", unset: [["sandbox", "network"], ["shell", "x"]] })
    expect(noop.changed).toBe(false)
    expect(JSON.parse(await Bun.file(file).text())).toEqual({ mcp: { servers: { docs: server } }, shell: "sh" })
  }),
  30_000,
)

test(
  "an empty unset path is rejected",
  boot({ global: { privacy_mode: true } }, async (_client, { directory, request }) => {
    const response = await request(
      `/api/rpc/kilocode.settings/write?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${btoa("opencode:secret")}` },
        body: JSON.stringify({ input: { scope: "global", unset: [[]] } }),
      },
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain("rpc.invalid_input")
  }),
  30_000,
)
