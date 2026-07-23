import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../../src/server/server"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { Config } from "../../../src/config/config"
import { KilocodeConfigOverlay } from "../../../src/kilocode/config/overlay"
import { Permission } from "../../../src/permission"
import { PtyPaths } from "../../../src/server/routes/instance/httpapi/groups/pty"
import { Filesystem } from "../../../src/util/filesystem"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

const original = Global.Path.config
const terminal = process.platform === "win32" ? test.skip : test.serial

type Overlay = {
  fields: Record<string, { source: string; inherited: boolean; overridden: boolean; value?: unknown }>
  collections: Record<string, Array<{ key: string; source: string; inherited: boolean; local?: unknown }>>
  targets: { project?: string; global?: string; active?: string }
}
type Agent = {
  name: string
  permission: Permission.Ruleset
  variant?: string
}

afterEach(async () => {
  ;(Global.Path as { config: string }).config = original
  await disposeAllInstances()
  await resetDatabase()
})

function req(dir: string, input: string, init?: RequestInit) {
  return Server.Default().app.request(input, {
    ...init,
    headers: {
      "x-kilo-directory": dir,
      ...init?.headers,
    },
  })
}

function app(_value: boolean) {
  return Server.Default().app
}

function request(target: ReturnType<typeof app>, dir: string | undefined, input: string, init?: RequestInit) {
  return target.request(input, {
    ...init,
    headers: {
      ...(dir ? { "x-kilo-directory": dir } : {}),
      ...init?.headers,
    },
  })
}

async function json<T>(response: Response) {
  expect(response.status).toBe(200)
  return (await response.json()) as T
}

async function config(dir: string, value: unknown) {
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify(value, null, 2))
}

async function setGlobal(dir: string, value: Config.Info) {
  ;(Global.Path as { config: string }).config = dir
  await json(
    await request(Server.Default().app, undefined, "/config/overlay", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "global", set: value }),
    }),
  )
}

async function capture(fn: () => Promise<void>) {
  const events: GlobalEvent[] = []
  const handler = (event: GlobalEvent) => events.push(event)
  GlobalBus.on("event", handler)
  try {
    await fn()
  } finally {
    GlobalBus.off("event", handler)
  }
  return events
}

describe("config overlay routes", () => {
  test("ignores unsafe patch paths", () => {
    const patched = KilocodeConfigOverlay.patch({
      scope: "project",
      unset: [
        ["__proto__", "polluted"],
        ["constructor", "prototype", "polluted"],
        ["prototype", "polluted"],
      ],
    })

    expect(Object.getPrototypeOf(patched)).toBe(Object.prototype)
    expect(Object.hasOwn(patched, "constructor")).toBe(false)
    expect(Object.hasOwn(patched, "prototype")).toBe(false)
  })

  test("prefers .kilo over legacy .kilocode and ignores .opencode in project overlays", async () => {
    await using project = await tmpdir()
    const entries = [
      {
        root: ".opencode",
        source: "opencode",
        value: { username: "opencode", model: "test/opencode", small_model: "test/opencode" },
      },
      {
        root: ".kilocode",
        source: "kilocode",
        value: { username: "kilocode", model: "test/kilocode" },
      },
      {
        root: ".kilo",
        source: "kilo",
        value: { username: "kilo" },
      },
    ] as const

    for (const item of entries) {
      const dir = path.join(project.path, item.root)
      await Filesystem.write(path.join(dir, "kilo.json"), JSON.stringify(item.value))
      await Filesystem.write(
        path.join(dir, "agent", "shared.md"),
        `---\ndescription: ${item.source} agent\nmode: subagent\n---\n${item.source} agent prompt`,
      )
    }
    await Filesystem.write(
      path.join(project.path, ".opencode", "agent", "opencode-only.md"),
      "---\ndescription: opencode-only agent\nmode: subagent\n---\nopencode-only agent prompt",
    )

    const body = await KilocodeConfigOverlay.resolve({
      directory: project.path,
      scope: "project",
      effective: {},
      global: {},
      sources: [],
    })

    expect(body.project.username).toBe("kilo")
    expect(body.project.model).toBe("test/kilocode")
    expect(body.project.small_model).toBeUndefined()
    expect(body.project.agent?.shared).toMatchObject({
      description: "kilo agent",
      prompt: "kilo agent prompt",
    })
    expect(body.project.agent?.["opencode-only"]).toBeUndefined()
    expect(body.targets.project).toBe(path.join(project.path, ".kilo", "kilo.json"))
  })

  test.serial("tolerates unsafe project config instead of failing the overlay", async () => {
    await using project = await tmpdir()
    // A project config that references a file outside the project root throws during substitution.
    // The overlay must skip it and still resolve, rather than rejecting the whole request.
    await Filesystem.write(
      path.join(project.path, ".kilo", "kilo.json"),
      JSON.stringify({ username: "{file:/etc/passwd}" }),
    )

    const body = await KilocodeConfigOverlay.resolve({
      directory: project.path,
      scope: "project",
      effective: {},
      global: {},
      sources: [],
    })

    expect(body.project.username ?? "").not.toContain("root:")
  })

  test.serial("marks global values inherited in project scope", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, {
      model: "kilo/global-model",
      permission: { bash: "ask" },
      mcp: { shared: { type: "local", command: ["node", "shared.js"], enabled: true } },
    })

    const body = await json<Overlay>(await req(project.path, "/config/overlay?scope=project"))

    expect(body.fields.model).toMatchObject({ source: "global", inherited: true, overridden: false })
    expect(body.collections.permission.find((item) => item.key === "bash")).toMatchObject({
      source: "global",
      inherited: true,
    })
    expect(body.collections.mcp.find((item) => item.key === "shared")).toMatchObject({
      source: "global",
      inherited: true,
    })
  })

  test.serial("resolves prompt-training model visibility across scopes", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ config: { hide_prompt_training_models: false } })
    await setGlobal(global.path, { hide_prompt_training_models: true })

    const body = await json<Overlay>(await req(project.path, "/config/overlay?scope=project"))

    expect(body.fields.hide_prompt_training_models).toMatchObject({
      source: "project",
      inherited: false,
      overridden: true,
      value: false,
    })
  })

  test.serial("marks global indexing values inherited in project scope", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, {
      indexing: {
        enabled: true,
        provider: "ollama",
        fileExtensions: [".php", ".js"],
        ollama: { baseUrl: "http://localhost:11434" },
      },
    })

    const body = await json<Overlay>(await req(project.path, "/config/overlay?scope=project"))

    expect(body.fields["indexing.enabled"]).toMatchObject({ source: "global", inherited: true, value: true })
    expect(body.fields["indexing.provider"]).toMatchObject({ source: "global", inherited: true, value: "ollama" })
    expect(body.fields["indexing.fileExtensions"]).toMatchObject({
      source: "global",
      inherited: true,
      value: [".php", ".js"],
    })
    expect(body.fields["indexing.ollama.baseUrl"]).toMatchObject({
      source: "global",
      inherited: true,
      value: "http://localhost:11434",
    })
  })

  test.serial("excludes project indexing values from global scope", async () => {
    await using project = await tmpdir()
    const global: Config.Info = {
      indexing: {
        enabled: true,
        provider: "openai",
        openai: { apiKey: "global-secret" },
      },
    }
    const local: Config.Info = {
      indexing: {
        enabled: false,
        provider: "ollama",
        ollama: { baseUrl: "http://project:11434" },
      },
    }
    await config(project.path, local)

    const body = await KilocodeConfigOverlay.resolve({
      directory: project.path,
      scope: "global",
      effective: local,
      global,
      sources: [],
    })

    expect(body.fields["indexing.enabled"]).toMatchObject({ source: "global", value: true })
    expect(body.fields["indexing.provider"]).toMatchObject({ source: "global", value: "openai" })
    expect(body.fields["indexing.openai.apiKey"]).toMatchObject({ source: "global", value: "global-secret" })
    expect(body.fields["indexing.ollama.baseUrl"]).toMatchObject({ source: "default" })
    expect(body.fields["indexing.ollama.baseUrl"].value).toBeUndefined()
  })

  test.serial("writes project indexing overrides to .kilo/kilo.jsonc", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { indexing: { enabled: true, provider: "openai" } })

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "project",
          set: { indexing: { enabled: false, provider: "ollama", ollama: { baseUrl: "http://127.0.0.1:11434" } } },
        }),
      }),
    )

    const file = path.join(project.path, ".kilo", "kilo.jsonc")
    const saved = (await Bun.file(file).json()) as { indexing: Record<string, unknown> }
    const body = await json<Overlay>(await req(project.path, "/config/overlay?scope=project"))

    expect(await Bun.file(path.join(project.path, ".kilo", "kilo.json")).exists()).toBe(false)
    expect(saved.indexing).toEqual({
      enabled: false,
      provider: "ollama",
      ollama: { baseUrl: "http://127.0.0.1:11434" },
    })
    expect(body.fields["indexing.enabled"]).toMatchObject({ source: "project", value: false })
    expect(body.fields["indexing.provider"]).toMatchObject({ source: "project", value: "ollama" })
  })

  test.serial("removes local scalar override and falls back to global", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ config: { model: "kilo/project-model", username: "alice" } })
    await setGlobal(global.path, { model: "kilo/global-model" })

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", unset: [["model"]] }),
      }),
    )
    const body = await json<Overlay>(await req(project.path, "/config/overlay?scope=project"))
    const saved = (await Bun.file(path.join(project.path, "opencode.json")).json()) as Record<string, unknown>

    expect(body.fields.model).toMatchObject({ source: "global", inherited: true })
    expect(saved.model).toBeUndefined()
    expect(saved.username).toBe("alice")
  })

  test.serial("writes project mcp overrides without copying inherited servers", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, {
      mcp: { shared: { type: "local", command: ["node", "shared.js"], enabled: true } },
    })

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "project",
          set: { mcp: { local: { type: "local", command: ["node", "local.js"], enabled: true } } },
        }),
      }),
    )

    const saved = (await Bun.file(path.join(project.path, ".kilo", "kilo.jsonc")).json()) as {
      mcp: Record<string, unknown>
    }
    expect(Object.keys(saved.mcp)).toEqual(["local"])
  })

  test.serial("disables inherited mcp server with a minimal local override", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, {
      mcp: { shared: { type: "local", command: ["node", "shared.js"], enabled: true } },
    })

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", set: { mcp: { shared: { enabled: false } } } }),
      }),
    )

    const saved = (await Bun.file(path.join(project.path, ".kilo", "kilo.jsonc")).json()) as {
      mcp: Record<string, unknown>
    }
    expect(saved.mcp).toEqual({ shared: { enabled: false } })
  })

  test.serial("refreshes effective config after project permission update", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { permission: { edit: "allow" } })

    const before = await json<Agent[]>(await req(project.path, "/agent"))
    expect(Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "allow",
    )

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", set: { permission: { edit: { "*": "ask" } } } }),
      }),
    )
    const body = await json<Overlay & { effective: { permission: Record<string, string | Record<string, string>> } }>(
      await req(project.path, "/config/overlay?scope=project"),
    )
    const edit = body.effective.permission.edit
    const after = await json<Agent[]>(await req(project.path, "/agent"))

    expect(typeof edit === "string" ? edit : edit["*"]).toBe("ask")
    expect(Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "ask",
    )
    expect(body.collections.permission.find((item) => item.key === "edit")).toMatchObject({
      source: "project",
      overridden: true,
    })
  })

  test.serial("refreshes agent permissions after global permission update", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    await setGlobal(global.path, { permission: { edit: "allow" } })

    const before = await json<Agent[]>(await req(project.path, "/agent"))
    expect(Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "allow",
    )

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "global", set: { permission: { edit: { "*": "ask" } } } }),
      }),
    )
    const body = await json<Overlay & { effective: { permission: Record<string, string | Record<string, string>> } }>(
      await req(project.path, "/config/overlay?scope=global"),
    )
    const edit = body.effective.permission.edit
    const after = await json<Agent[]>(await req(project.path, "/agent"))

    expect(typeof edit === "string" ? edit : edit["*"]).toBe("ask")
    expect(Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action).toBe(
      "ask",
    )
  })

  test.serial("keeps global config variant updates hot through global config route", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path

    const before = await json<Agent[]>(await request(Server.Default().app, project.path, "/agent"))
    expect(before.find((item) => item.name === "code")?.variant).toBeUndefined()

    const events = await capture(async () => {
      await json(
        await request(Server.Default().app, undefined, "/global/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: { code: { variant: "high" } } }),
        }),
      )
    })
    const after = await json<Agent[]>(await request(Server.Default().app, project.path, "/agent"))

    expect(events.some((event) => event.payload?.type === "global.config.updated")).toBe(true)
    expect(events.some((event) => event.payload?.type === "global.disposed")).toBe(false)
    expect(after.find((item) => item.name === "code")?.variant).toBe("high")
  })

  test.serial("refreshes hot global variants in every cached project directory", async () => {
    await using global = await tmpdir()
    await using first = await tmpdir()
    await using second = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const server = Server.Default().app

    const before = await Promise.all(
      [first.path, second.path].map(async (dir) => json<Agent[]>(await request(server, dir, "/agent"))),
    )
    expect(before.map((agents) => agents.find((item) => item.name === "code")?.variant)).toEqual([
      undefined,
      undefined,
    ])

    const events = await capture(async () => {
      await json(
        await request(server, first.path, "/global/config", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: { code: { variant: "high" } } }),
        }),
      )
    })

    const one = await json<Agent[]>(await request(server, first.path, "/agent"))
    const two = await json<Agent[]>(await request(server, second.path, "/agent"))
    expect(one.find((item) => item.name === "code")?.variant).toBe("high")
    expect(two.find((item) => item.name === "code")?.variant).toBe("high")
    expect(events.some((event) => event.payload?.type === "global.disposed")).toBe(false)
  })

  test.serial("keeps global config variant updates hot through overlay route", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path

    const before = await json<Agent[]>(await request(Server.Default().app, project.path, "/agent"))
    expect(before.find((item) => item.name === "code")?.variant).toBeUndefined()

    const events = await capture(async () => {
      await json(
        await request(Server.Default().app, undefined, "/config/overlay", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "global", set: { agent: { code: { variant: "medium" } } } }),
        }),
      )
    })
    const after = await json<Agent[]>(await request(Server.Default().app, project.path, "/agent"))

    expect(events.some((event) => event.payload?.type === "global.config.updated")).toBe(true)
    expect(events.some((event) => event.payload?.type === "global.disposed")).toBe(false)
    expect(after.find((item) => item.name === "code")?.variant).toBe("medium")
  })

  terminal("preserves active terminals after updating global console preferences", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const headers = { "x-kilo-directory": project.path }
    const created = await Server.Default().app.request(PtyPaths.create, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 30"], title: "console" }),
    })
    const info = await json<{ id: string }>(created)

    try {
      await json(
        await request(Server.Default().app, undefined, "/config/overlay", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "global", set: { console: { diff_style: "split" } } }),
        }),
      )

      const found = await Server.Default().app.request(PtyPaths.get.replace(":ptyID", info.id), { headers })
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({ id: info.id, title: "console", status: "running" })
    } finally {
      await Server.Default().app.request(PtyPaths.remove.replace(":ptyID", info.id), { method: "DELETE", headers })
    }
  })

  for (const value of [false, true]) {
    test.serial(
      `${value ? "httpapi" : "legacy"} global overlay update refreshes existing project instances without a project directory`,
      async () => {
        await using global = await tmpdir()
        await using project = await tmpdir()
        await setGlobal(global.path, { permission: { edit: "ask" } })
        await disposeAllInstances()
        const target = app(value)

        const before = await json<Agent[]>(await request(target, project.path, "/agent"))
        expect(
          Permission.evaluate("edit", "*", before.find((item) => item.name === "code")?.permission ?? []).action,
        ).toBe("ask")

        await json(
          await request(target, undefined, "/config/overlay", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scope: "global", set: { permission: { edit: { "*": "allow" } } } }),
          }),
        )
        const after = await json<Agent[]>(await request(target, project.path, "/agent"))

        expect(
          Permission.evaluate("edit", "*", after.find((item) => item.name === "code")?.permission ?? []).action,
        ).toBe("allow")
      },
    )
  }
})
