import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Flag } from "@opencode/core/flag"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { loadPlugins } from "./lib/plugins"

// `kilo debug permissions list|reset|check` run as the real CLI process against a real Kilo server:
// the in-process routes behind an HTTP listener for --server, or a private server for --standalone.
const host = path.dirname(import.meta.dir)
const login = new Set(["KILO_API_KEY", "KILOCODE_TOKEN", "KILO_AUTH_CONTENT", "KILO_ORG_ID", "KILO_AI_GATEWAY_URL"])
const help =
  "help: Restart an open TUI to show automatic permission setup offers again; saved permission grants are unchanged.\n"

type Client = ReturnType<typeof OpenCode.make>

async function cli(root: string, cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, path.join(host, "src/index.ts"), ...args], {
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !login.has(key) && !key.startsWith("OPENCODE_FLAGS") && !key.startsWith("npm_"),
        ),
      ),
      // The working directory has no bunfig.toml, so name the preload that compiles the TUI modules the CLI imports.
      BUN_OPTIONS: `--preload ${path.join(host, "src/branding/preload.ts").replace(/[\s\\"']/g, (char) => `\\${char}`)}`,
      HOME: root,
      USERPROFILE: root,
      OPENCODE_TEST_HOME: root,
      OPENCODE_PASSWORD: "secret",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => child.kill(), 45_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  return { stdout, stderr, code }
}

// The Kilo host's routes behind a real HTTP listener, so the CLI reaches them with --server.
async function withServer(
  root: string,
  projects: string[],
  flags: string | undefined,
  body: (url: string, client: Client) => Promise<void>,
) {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          createRoutes(
            {
              password: "secret",
              database: { path: ":memory:" },
              models: { fetch: false },
              fs: { filewatcher: false },
              config: { directory: path.join(root, "global"), project: false },
            },
            () => [],
            [
              ...KiloHost.overrides,
              Flag.node.replace(
                Flag.node.mapLayer((layer) =>
                  layer.pipe(Layer.provide(Layer.succeed(Flag.Overrides, KiloHost.schedulingOverrides(flags)))),
                ),
              ),
            ],
          ).pipe(Layer.provide(HttpServer.layerServices)),
        )
        const handler = Context.get(context, HttpRouter.HttpRouter)
          .asHttpEffect()
          .pipe(HttpEffect.toWebHandlerWith(context))
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handler(request) })
        yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
        // waitForPlugins in the handlers only waits for a first plugin; load the permissions plugin before the CLI runs.
        yield* Effect.forEach(projects, (directory) => loadPlugins(context, directory))
        const url = server.url.toString()
        const client = OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${btoa("opencode:secret")}` } })
        yield* Effect.promise(() => body(url, client))
      }),
    ).pipe(Effect.provideService(References.MinimumLogLevel, "Error")),
  )
}

// A TypeScript repository with its own project identity (see permissions-rpc.test.ts).
async function project(root: string, name: string) {
  const directory = path.join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ packageManager: "bun@1.4.4", devDependencies: { typescript: "^5" } }),
  )
  await writeFile(path.join(directory, "tsconfig.json"), "{}")
  await Bun.$`git init --quiet`.cwd(directory)
  await Bun.$`git -c user.name=kilo -c user.email=kilo@example.com commit --quiet --allow-empty -m ${directory}`.cwd(
    directory,
  )
  return directory
}

async function temporary(prefix: string) {
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)))
}

test("debug permissions list and reset resolve --directory and report through --server", async () => {
  const root = await temporary("kilo-permissions-cmd-")
  const directory = await project(root, "typescript")
  try {
    await withServer(root, [directory], undefined, async (url, client) => {
      const rpc = client.rpc(KiloPermissionsRpc.Definition)
      const options = { location: { directory } }
      await rpc.apply({ presetID: "typescript-checks" }, options)
      const resources = (await rpc.list({}, options)).applied[0]!.resources

      // A relative --directory resolves against the working directory.
      const listed = await cli(root, root, "debug", "permissions", "list", "--server", url, "--directory", "typescript")
      expect(listed.code, listed.stderr).toBe(0)
      expect(listed.stdout.split("\n").slice(0, 3)).toEqual([
        "permissions: 0 saved grants",
        `active set: typescript-checks (${resources.length} grants)`,
        `active[${resources.length}]{set,resource}:`,
      ])
      expect(listed.stdout).toContain('  "typescript-checks","bun run test *"\n')

      // Without --directory the command targets the working directory.
      const reset = await cli(root, directory, "debug", "permissions", "reset", "--server", url)
      expect(reset.code, reset.stderr).toBe(0)
      expect(reset.stdout).toBe(`permissions: reset ${directory}\n${help}`)
      expect(await rpc.list({}, options)).toMatchObject({ decision: null, applied: [{ id: "typescript-checks" }] })

      const all = await cli(
        root,
        root,
        "debug",
        "permissions",
        "reset",
        "--all",
        "--server",
        url,
        "--directory",
        directory,
      )
      expect(all.code, all.stderr).toBe(0)
      expect(all.stdout).toBe(
        `permissions: reset-all ${directory} (removed ${resources.length} rules from applied sets)\n${help}`,
      )
      expect(await rpc.list({}, options)).toMatchObject({ decision: null, applied: [] })

      const empty = await cli(root, directory, "debug", "permissions", "list", "--server", url)
      expect(empty.code, empty.stderr).toBe(0)
      expect(empty.stdout).toBe("permissions: 0 saved grants\nactive set: none\n")
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("debug permissions check checks a command file and reports RPC errors with exit status 1", async () => {
  const root = await temporary("kilo-permissions-debug-")
  const directory = await project(root, "typescript")
  const file = path.join(root, "commands.txt")
  await writeFile(file, ["# install", "bun install --frozen-lockfile 2>&1", "", "  git push  ", ""].join("\n"))
  try {
    await withServer(root, [directory], undefined, async (url) => {
      const checked = await cli(root, directory, "debug", "permissions", "check", file, "--server", url)
      expect(checked.code, checked.stderr).toBe(0)
      expect(checked.stdout).toBe(
        "permissions: dependency-install, 2 commands: 1 allowed, 1 ask\nask  git push\n     not granted: git push\n",
      )

      // A relative file resolves against the working directory, --directory against it too.
      const preset = await cli(
        root,
        root,
        "debug",
        "permissions",
        "check",
        "commands.txt",
        "--preset",
        "typescript-checks",
        "--server",
        url,
        "--directory",
        "typescript",
      )
      expect(preset.code, preset.stderr).toBe(0)
      expect(preset.stdout).toStartWith("permissions: typescript-checks, 2 commands: 0 allowed, 2 ask\n")

      const missing = await cli(
        root,
        directory,
        "debug",
        "permissions",
        "check",
        file,
        "--preset",
        "kilo-bun-checks",
        "--server",
        url,
      )
      expect(missing.stdout).toBe("")
      expect(missing.stderr).toContain("error: the permission set does not apply to this project\n")
      expect(missing.code).toBe(1)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("debug permissions check fails on a missing file before it connects to a server", async () => {
  const root = await temporary("kilo-permissions-missing-")
  try {
    // Nothing listens on port 1: connecting would fail with a different error.
    const result = await cli(
      root,
      root,
      "debug",
      "permissions",
      "check",
      "absent.txt",
      "--server",
      "http://127.0.0.1:1",
    )
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`error: file not found: ${path.join(root, "absent.txt")}\n`)
    expect(result.code).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("rejects an unknown --preset and combined --server and --standalone", async () => {
  const root = await temporary("kilo-permissions-args-")
  const file = path.join(root, "commands.txt")
  await writeFile(file, "git push\n")
  try {
    const preset = await cli(root, root, "debug", "permissions", "check", file, "--preset", "everything")
    expect(preset.stdout).not.toContain("permissions:")
    expect(preset.code).not.toBe(0)

    const combined = await cli(
      root,
      root,
      "debug",
      "permissions",
      "list",
      "--server",
      "http://127.0.0.1:1",
      "--standalone",
    )
    expect(combined.stdout).toBe("")
    expect(combined.stderr).toContain("--server and --standalone cannot be combined")
    expect(combined.code).not.toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("reports disabled permission setup from list, reset and check", async () => {
  const root = await temporary("kilo-permissions-disabled-")
  const directory = await project(root, "typescript")
  const file = path.join(root, "commands.txt")
  await writeFile(file, "git push\n")
  try {
    await withServer(root, [directory], "-permission_setup", async (url) => {
      const listed = await cli(root, directory, "debug", "permissions", "list", "--server", url)
      expect(listed.code, listed.stderr).toBe(0)
      expect(listed.stdout).toBe(
        "permissions: 0 saved grants\nactive set: none (permission setup is disabled, flag permission_setup)\n",
      )

      const reset = await cli(root, directory, "debug", "permissions", "reset", "--server", url)
      expect(reset.stdout).toBe("")
      expect(reset.stderr).toContain("error: permission setup is disabled (flag permission_setup)\n")
      expect(reset.code).toBe(1)

      const checked = await cli(root, directory, "debug", "permissions", "check", file, "--server", url)
      expect(checked.stdout).toBe("")
      expect(checked.stderr).toContain("error: permission setup is disabled (flag permission_setup)\n")
      expect(checked.code).toBe(1)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("debug permissions list and check run on a private server with --standalone", async () => {
  const root = await temporary("kilo-permissions-standalone-")
  const directory = await project(root, "typescript")
  const file = path.join(root, "commands.txt")
  await writeFile(file, "bun install\n")
  try {
    const listed = await cli(root, root, "debug", "permissions", "list", "--standalone", "--directory", directory)
    expect(listed.code, listed.stderr).toBe(0)
    expect(listed.stdout).toBe("permissions: 0 saved grants\nactive set: none\n")

    const checked = await cli(root, directory, "debug", "permissions", "check", file, "--standalone")
    expect(checked.code, checked.stderr).toBe(0)
    expect(checked.stdout).toBe("permissions: dependency-install, 1 commands: 1 allowed, 0 ask\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
