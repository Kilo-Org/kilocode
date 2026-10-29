import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const entry = path.join(import.meta.dir, "../src/index.ts")

// U-E1-01 part 1 (D-4): every process the host starts keeps its config, data, cache, state and tmp in Kilo v2's
// own `kilo2` directories, and creates nothing in the `opencode` or `kilo` directories. The CLI, the background
// service it spawns and a `serve --stdio` server boot with a temporary HOME and TMPDIR.
test("a boot without XDG variables keeps everything under the kilo2 directories of HOME", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-app-dirs-")))
  try {
    const paths = await boot(root, {})
    const expected = {
      data: path.join(root, ".local/share/kilo2"),
      config: path.join(root, ".config/kilo2"),
      cache: path.join(root, ".cache/kilo2"),
      state: path.join(root, ".local/state/kilo2"),
      tmp: path.join(root, "tmp/kilo2"),
    }
    expect(paths).toMatchObject({
      ...expected,
      bin: path.join(expected.cache, "bin"),
      log: path.join(expected.data, "log"),
      repos: path.join(expected.data, "repos"),
      // Part 1 changes directories only: upstream's file names stay.
      db: path.join(expected.data, "opencode-local.db"),
    })
    await created(expected)
    expect(await strays(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("a boot with XDG variables keeps everything under the kilo2 directories of XDG", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-app-dirs-xdg-")))
  try {
    const paths = await boot(root, {
      XDG_DATA_HOME: path.join(root, "xdg/data"),
      XDG_CONFIG_HOME: path.join(root, "xdg/config"),
      XDG_CACHE_HOME: path.join(root, "xdg/cache"),
      XDG_STATE_HOME: path.join(root, "xdg/state"),
    })
    const expected = {
      data: path.join(root, "xdg/data/kilo2"),
      config: path.join(root, "xdg/config/kilo2"),
      cache: path.join(root, "xdg/cache/kilo2"),
      state: path.join(root, "xdg/state/kilo2"),
      tmp: path.join(root, "tmp/kilo2"),
    }
    expect(paths).toMatchObject({ ...expected, db: path.join(expected.data, "opencode-local.db") })
    await created(expected)
    expect(await strays(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("KILO2_CONFIG_DIR overrides the config directory", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-app-dirs-config-")))
  try {
    const config = path.join(root, "custom-config")
    const result = await cli(environment(root, { KILO2_CONFIG_DIR: config }), "debug", "paths")
    expect(parse(result).config).toBe(config)
    expect(parse(result).data).toBe(path.join(root, ".local/share/kilo2"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

// A v1 user can have KILO_DB, KILO_CONFIG and KILO_CONFIG_DIR set to v1's own storage. v2 ignores them: it keeps its
// database and config under kilo2, and v1's files stay byte for byte as they were.
test("v1 storage variables leave v1's database, config and credentials untouched", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-app-dirs-v1-")))
  try {
    const data = path.join(root, ".local/share/kilo")
    const config = path.join(root, ".config/kilo")
    await mkdir(data, { recursive: true })
    await mkdir(config, { recursive: true })
    const v1 = {
      [path.join(data, "kilo.db")]: "v1 database",
      [path.join(data, "auth.json")]: JSON.stringify({ kilo: { type: "api", key: "v1-key" } }),
      [path.join(config, "kilo.json")]: JSON.stringify({ model: "kilo/v1" }),
    }
    await Promise.all(Object.entries(v1).map(([file, content]) => Bun.write(file, content)))
    const listing = async () => [...(await readdir(data)), ...(await readdir(config))].toSorted()
    const before = await listing()

    const paths = await boot(root, {
      KILO_DB: path.join(data, "kilo.db"),
      KILO_CONFIG: path.join(config, "kilo.json"),
      KILO_CONFIG_DIR: config,
    })

    expect(paths).toMatchObject({
      config: path.join(root, ".config/kilo2"),
      db: path.join(root, ".local/share/kilo2/opencode-local.db"),
    })
    expect(await listing()).toEqual(before)
    for (const [file, content] of Object.entries(v1)) expect(await Bun.file(file).text()).toBe(content)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

// Runs `debug paths`, a background service lifecycle with one Location boot, and a `serve --stdio` server with one
// Location boot. Returns the paths the CLI reports.
async function boot(root: string, xdg: Record<string, string>) {
  using backend = fixture()
  const env = environment(root, { ...xdg, KILO_API_URL: backend.url })
  await mkdir(env.TMPDIR, { recursive: true })
  const paths = parse(await cli(env, "debug", "paths"))
  try {
    // A free port, so the test does not meet another service on the default port.
    const port = free()
    await cli(env, "service", "set", "port", String(port))
    const url = await cli(env, "service", "start")
    await plugins(url, root, await cli(env, "service", "get", "password"))
  } finally {
    await cli(env, "service", "stop").catch(() => undefined)
  }
  await stdio(env, root)
  return paths
}

function environment(root: string, extra: Record<string, string>) {
  // The test preload isolates XDG for in-process tests; a host boot must not inherit it, or any directory override.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("XDG_") && !/^(OPENCODE|KILO)_/.test(key)),
  )
  return {
    ...inherited,
    HOME: root,
    USERPROFILE: root,
    // os.tmpdir() reads TMPDIR on POSIX and TEMP or TMP on Windows.
    TMPDIR: path.join(root, "tmp"),
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    ...extra,
  }
}

async function cli(env: Record<string, string | undefined>, ...args: string[]) {
  // The package directory, so its bunfig.toml preload compiles the TUI modules the CLI imports. The service
  // inherits it.
  const child = Bun.spawn([process.execPath, entry, ...args], {
    cwd: path.dirname(import.meta.dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return stdout.trim()
}

async function stdio(env: Record<string, string | undefined>, root: string) {
  const child = Bun.spawn([process.execPath, entry, "serve", "--stdio"], {
    cwd: path.dirname(import.meta.dir),
    env: { ...env, OPENCODE_SERVER_PASSWORD: "secret" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const reader = child.stdout.getReader()
    const line = async (buffer = ""): Promise<string> => {
      if (buffer.includes("\n")) return buffer.slice(0, buffer.indexOf("\n"))
      const chunk = await reader.read()
      if (chunk.done) return buffer
      return line(buffer + new TextDecoder().decode(chunk.value))
    }
    const url = (JSON.parse(await line()) as { url: string }).url
    reader.releaseLock()
    await plugins(url, root, "secret")
  } finally {
    child.stdin.end()
    await child.exited
  }
}

// The first request boots the Location (database, plugins, locks); its plugins activate shortly after.
async function plugins(url: string, directory: string, password: string, remaining = 100): Promise<unknown[]> {
  const body = await fetch(new URL(`/api/plugin?location[directory]=${encodeURIComponent(directory)}`, url), {
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json())
  if (body.data.length > 0 || remaining === 0) return body.data
  await Bun.sleep(100)
  return plugins(url, directory, password, remaining - 1)
}

function parse(output: string) {
  return Object.fromEntries(
    output.split("\n").map((line) => {
      const [key, ...value] = line.trim().split(/\s+/)
      return [key, value.join(" ")]
    }),
  )
}

function free() {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = probe.port
  probe.stop(true)
  return port
}

async function created(expected: Record<string, string>) {
  const listed = await Promise.all(
    Object.values(expected).map((directory) => readdir(directory).catch(() => undefined)),
  )
  expect(listed.every((entries) => entries !== undefined)).toBe(true)
  // The boot wrote the database and the log into the kilo2 data directory.
  expect(await readdir(expected.data)).toEqual(expect.arrayContaining(["opencode-local.db", "log"]))
  expect((await readdir(path.join(expected.data, "log"))).some((name) => name.endsWith(".log"))).toBe(true)
}

// Every directory under the root that is named after the opencode or Kilo v1 app directory.
async function strays(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === "opencode" || entry.name === "kilo"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .toSorted()
}
