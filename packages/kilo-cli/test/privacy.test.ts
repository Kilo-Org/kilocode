import { expect, test } from "bun:test"
import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { RpcCallContext, RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import { Effect } from "effect"
import { chmod, link, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Layout } from "../src/paths"
import { createPrivacyPlugin, createPrivacyRpcHandlers } from "../src/privacy"
import { PrivacyRpc } from "../src/privacy-rpc"
import { createPrivacyStore } from "../src/privacy-settings"
import { parsePrivacyCommand, privacyUiRequestOptions } from "../src/tui-plugin/privacy"

test("defaults to profile privacy off and persists on/off without a project scope", async () => {
  await using host = await isolated()
  const store = createPrivacyStore({ layout: host.layout })

  expect(await store.read()).toEqual({ enabled: false, scope: "profile" })
  expect(await store.set(true)).toEqual({ enabled: true, scope: "profile" })
  expect(await Bun.file(host.layout.config).text()).toContain('"privacy_mode": true')
  expect(await store.read()).toEqual({ enabled: true, scope: "profile" })
  expect(await store.set(false)).toEqual({ enabled: false, scope: "profile" })
  expect(await Bun.file(host.layout.config).text()).toContain('"privacy_mode": false')
})

test("preserves JSONC profile content, secrets, and the existing file mode", async () => {
  await using host = await isolated()
  const secret = "profile-secret-privacy-test"
  await host.writeProfile(`{
  // Keep this comment and unrelated provider data.
  "providers": { "fixture": { "apiKey": "${secret}" } }
}
`)
  await chmod(host.layout.config, 0o644)

  const store = createPrivacyStore({ layout: host.layout })
  await store.set(true)

  const source = await Bun.file(host.layout.config).text()
  expect(source).toContain("Keep this comment")
  expect(source).toContain(secret)
  expect(source).toContain('"privacy_mode": true')
  expect((await lstat(host.layout.config)).mode & 0o777).toBe(0o644)
})

test("serializes writes and leaves malformed or invalid privacy documents untouched", async () => {
  await using host = await isolated()
  const store = createPrivacyStore({ layout: host.layout })

  await Promise.all([store.set(true), store.set(false), store.set(true)])
  expect(await store.read()).toEqual({ enabled: true, scope: "profile" })

  const malformed = "{ \"privacy_mode\": true\n"
  await host.writeProfile(malformed)
  await expect(store.set(false)).rejects.toThrow(/not a JSON or JSONC object/)
  expect(await Bun.file(host.layout.config).text()).toBe(malformed)

  const wrongType = '{ "privacy_mode": "yes" }\n'
  await host.writeProfile(wrongType)
  await expect(store.read()).rejects.toThrow(/privacy_mode value is not boolean/)
  await expect(store.set(true)).rejects.toThrow(/privacy_mode value is not boolean/)
  expect(await Bun.file(host.layout.config).text()).toBe(wrongType)
})

test("rejects symlinked and hardlinked profile documents without touching the target", async () => {
  await using host = await isolated()
  const foreign = path.join(host.root, "foreign.jsonc")
  const contents = '{ "privacy_mode": true }\n'
  await writeFile(foreign, contents, { mode: 0o600 })
  await mkdir(path.dirname(host.layout.config), { recursive: true })
  await symlink(foreign, host.layout.config)

  const linkedStore = createPrivacyStore({ layout: host.layout })
  await expect(linkedStore.read()).rejects.toThrow(/protected|symlink|non-regular/)
  await expect(linkedStore.set(false)).rejects.toThrow(/protected|symlink|non-regular/)
  expect(await Bun.file(foreign).text()).toBe(contents)

  await rm(host.layout.config)
  await link(foreign, host.layout.config)
  await expect(linkedStore.set(false)).rejects.toThrow(/protected|shared|non-regular/)
  expect(await Bun.file(foreign).text()).toBe(contents)
})

test("keeps profile RPC output bounded to the privacy state", async () => {
  await using host = await isolated()
  const handlers = createPrivacyRpcHandlers({ layout: host.layout })

  expect(await Effect.runPromise(handlers.read({}, rpcCall<"read">()))).toEqual({ enabled: false, scope: "profile" })
  expect(await Effect.runPromise(handlers.set({ enabled: true }, rpcCall<"set">()))).toEqual({
    enabled: true,
    scope: "profile",
  })
  expect(JSON.stringify(await Effect.runPromise(handlers.read({}, rpcCall<"read">())))).not.toContain(host.layout.config)
})

test("registers the privacy RPC through the v2 plugin boundary", async () => {
  await using host = await isolated()
  const registered: string[] = []
  const context = {
    rpc: {
      register: (definition: typeof PrivacyRpc.Definition) => {
        registered.push(definition.id)
        return Effect.succeed({ dispose: Effect.void, events: { emit: () => Effect.void } })
      },
    },
  }

  await Effect.runPromise(
    Effect.scoped(createPrivacyPlugin({ layout: host.layout }).effect(context as unknown as Context)),
  )
  expect(registered).toEqual(["kilocode.privacy"])
})

test("accepts only explicit privacy on/off commands", () => {
  expect(parsePrivacyCommand("on")).toEqual({ enabled: true })
  expect(parsePrivacyCommand(" off ")).toEqual({ enabled: false })
  expect(parsePrivacyCommand()).toEqual({ kind: "usage", reason: "Run /privacy on or /privacy off." })
  expect(parsePrivacyCommand("status")).toEqual({ kind: "usage", reason: "Run /privacy on or /privacy off." })
})

test("builds privacy RPC options from the public TUI location", () => {
  const signal = new AbortController().signal
  const context = {
    location: { directory: "/tmp/privacy-project", workspaceID: "privacy-workspace" },
    data: { location: { default: () => ({ directory: "/tmp/privacy-default" }) } },
  } as unknown as Parameters<typeof privacyUiRequestOptions>[0]

  expect(privacyUiRequestOptions(context, signal)).toEqual({
    signal,
    location: { directory: "/tmp/privacy-project", workspace: "privacy-workspace" },
  })
})

type PrivacyHandlers = RpcHandlers<typeof PrivacyRpc.Definition>

function rpcCall<M extends keyof PrivacyHandlers>() {
  return {
    error: (type: string, message: string) => ({ type, message }),
  } as unknown as RpcCallContext<(typeof PrivacyRpc.Definition.methods)[M]>
}

async function isolated() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo2-privacy-test-")))
  const layout = await isolatedLayout(root)
  return {
    root,
    layout,
    writeProfile: async (source: string) => {
      await mkdir(path.dirname(layout.config), { recursive: true })
      await writeFile(layout.config, source, { encoding: "utf8", mode: 0o600 })
    },
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

async function isolatedLayout(root: string) {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive" as const,
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  } satisfies Layout
}
