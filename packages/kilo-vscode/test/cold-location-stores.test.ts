// The webview stores that read a Kilo RPC when the connection comes up, on a server whose Location is still
// activating. The server answers `rpc.unavailable` until the Location's plugins are registered, the same answer as a
// server without the plugin, so a store that reads at connect time must still end with the data of a healthy server.
// A Location activates on the first request that names it, so the webview's own first reads are the ones that race.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { unlinkSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"
import { command, start, stop, type Server } from "../src/server"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")
const id = crypto.randomUUID()
// The stores read webview contexts, so each fixture is bundled like the webview and runs in its own process.
const bundles = {
  mocked: path.join(root, `.cold-location-mocked-${id}.mjs`),
  real: path.join(root, `.cold-location-stores-${id}.mjs`),
}

type Call = { rpc: string; method: string; at: number; ok: boolean; type?: string }
type Result = {
  version: string
  handshake?: unknown
  sandbox?: { ready: boolean; available?: boolean; disabled: boolean }
  calls: Call[]
}

beforeAll(async () => {
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
  const aliases: Record<string, string> = {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
    "solid-js/store": path.join(solid, "store/dist/store.js"),
  }
  const bundle = async (entry: string, file: string) => {
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures", entry)],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      platform: "node",
      logLevel: "silent",
      loader: { ".css": "empty", ".svg": "text" },
      plugins: [
        {
          name: "solid-dedupe",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          },
        },
        createSolidPlugin({ root }),
      ],
      target: "es2022",
      write: false,
    })
    await Bun.write(file, result.outputFiles[0]!.contents)
  }
  await bundle("cold-location-mocked.tsx", bundles.mocked)
  await bundle("cold-location-stores.tsx", bundles.real)
}, 120_000)

afterAll(() => Object.values(bundles).forEach((file) => unlinkSync(file)))

async function run(file: string, env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, file], {
    cwd: webview,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

async function boot(storage: string) {
  const found = command({ extension: root, storage, env: {} })
  if (!found) throw new Error("dev entry not found")
  const workspace = path.join(storage, "workspace")
  const server = await start({ command: found, cwd: workspace, env: { ...process.env, INIT_CWD: storage } })
  return { server, workspace }
}

async function shutdown(server: Server) {
  const exited = new Promise((resolve) => server.process.once("exit", resolve))
  stop(server.process)
  await exited
}

/** A session that a previous server run left in the workspace, as a restored sidebar tab names one. */
async function seed(storage: string) {
  const { server, workspace } = await boot(storage)
  const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
  const session = await api.session.create({ location: { directory: workspace } }).finally(() => shutdown(server))
  return session.id
}

/**
 * Starts the server as the extension does and mounts the sidebar data layer with one store, before any other request.
 * With `warm`, the Location of the workspace has its plugins and the store mounts on another directory of that
 * server, as the Agent Manager opens a worktree.
 */
async function mount(input: { store: "wakeups" | "background-jobs" | "sandbox"; session?: boolean; warm?: boolean }) {
  const storage = await mkdtemp(path.join(tmpdir(), "kilo-vscode-cold-"))
  const session = input.session ? await seed(storage) : ""
  const { server, workspace } = await boot(storage)
  try {
    const directory = input.warm ? path.join(storage, "worktree") : workspace
    if (input.warm) {
      await mkdir(directory)
      const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
      const listed = async () => (await api.plugin.list({ location: { directory: workspace } })).data.length > 0
      for (const deadline = Date.now() + 30_000; Date.now() < deadline && !(await listed()); ) await Bun.sleep(25)
    }
    const child = await run(bundles.real, {
      KILO_COLD_URL: server.url,
      KILO_COLD_AUTHORIZATION: server.authorization,
      KILO_COLD_DIRECTORY: directory,
      KILO_COLD_STORE: input.store,
      KILO_COLD_SESSION: session,
    })
    const line = child.stdout.split("\n").find((item) => item.startsWith("RESULT "))
    if (child.code !== 0 || !line) throw new Error(`fixture failed (${child.code})\n${child.stdout}\n${child.stderr}`)
    return JSON.parse(line.slice("RESULT ".length)) as Result
  } finally {
    await shutdown(server)
    await rm(storage, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

const answered = (result: Result, rpc: string, method: string) =>
  result.calls.some((call) => call.rpc === rpc && call.method === method && call.ok)
/** The answers of the Kilo RPCs in order, with the milliseconds since the webview started, for a failed expectation. */
const trace = (result: Result) =>
  result.calls.map((call) => `${call.at}ms ${call.rpc}.${call.method} ${call.ok ? "ok" : call.type}`).join("\n")

describe("webview stores on a mocked server whose Location starts without its plugins", () => {
  const cases = {
    cold: "ends with the data once the Location lists its plugins",
    unsupported: "is asked twice and then left alone by a server that lists its plugins without this one",
    dropped: "stops waiting when the connection drops and reads again on the next one",
    disposed: "stops waiting when its owner is disposed",
  }
  for (const store of ["background-jobs", "sandbox"])
    for (const [name, title] of Object.entries(cases))
      test(`${store} ${title}`, async () => {
        const child = await run(bundles.mocked, { KILO_COLD_SCENARIO: `${store}:${name}` })
        expect(child.code, child.stdout + child.stderr).toBe(0)
      }, 30_000)
})

describe("webview stores on a real server whose Location is still activating", () => {
  test("the sidebar reads the pending wakeups of its directory", async () => {
    const result = await mount({ store: "wakeups" })
    expect(result.version).not.toBe("")
    expect(answered(result, "kilocode.wakeup", "pending"), trace(result)).toBe(true)
  }, 120_000)

  test("a session view lists the background jobs of its session", async () => {
    const result = await mount({ store: "background-jobs", session: true })
    expect(result.version).not.toBe("")
    expect(answered(result, "kilocode.background-jobs", "list"), trace(result)).toBe(true)
  }, 120_000)

  test("a draft composer reads the sandbox support", async () => {
    const result = await mount({ store: "sandbox" })
    expect(result.version).not.toBe("")
    expect(answered(result, "kilocode.sandbox", "support"), trace(result)).toBe(true)
    expect(result.sandbox?.ready, trace(result)).toBe(true)
  }, 120_000)

  test("a session view reads the sandbox status of its session", async () => {
    const result = await mount({ store: "sandbox", session: true })
    expect(result.version).not.toBe("")
    expect(answered(result, "kilocode.sandbox", "support"), trace(result)).toBe(true)
    expect(answered(result, "kilocode.sandbox", "status"), trace(result)).toBe(true)
    expect(result.sandbox?.ready, trace(result)).toBe(true)
  }, 120_000)

  test("a draft composer reads the sandbox support of a directory first opened on a running server", async () => {
    const result = await mount({ store: "sandbox", warm: true })
    expect(result.version).not.toBe("")
    expect(answered(result, "kilocode.sandbox", "support"), trace(result)).toBe(true)
    expect(result.sandbox?.ready, trace(result)).toBe(true)
  }, 120_000)
})
