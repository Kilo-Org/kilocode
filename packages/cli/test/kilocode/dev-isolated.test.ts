import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"

test("isolated dev passes the JSX preload and existing Bun options to standalone children", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo dev-standalone-"))
  const preload = path.join(root, "preload.ts")
  await Bun.write(
    preload,
    'console.error("KILO_DEV_PRELOAD", process.argv[2], process.execArgv.includes("--conditions=kilo-dev-test"))\n',
  )
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "../../../../script/dev-isolated.ts"),
      "session",
      "list",
      "--standalone",
      "--format",
      "json",
    ],
    {
      cwd: root,
      env: isolatedEnv(root, {
        BUN_OPTIONS: `--preload ${preload.replace(/[\s\\"']/g, (char) => `\\${char}`)} --conditions=kilo-dev-test`,
        INIT_CWD: undefined,
        KILO_API_KEY: undefined,
        KILO_V2_PROFILE: path.join(root, "profile"),
        OPENCODE_PRINT_LOGS: "1",
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toContain("KILO_DEV_PRELOAD session true")
    expect(stderr).toContain("KILO_DEV_PRELOAD serve true")
    expect(stderr).not.toContain("Kilo login from v1 Kilo")
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
  } finally {
    child.kill()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("isolated dev ignores the database, home, session and client of a parent Kilo process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo dev-inherited-"))
  const preload = path.join(root, "preload.ts")
  const names = [
    "OPENCODE_DB",
    "KILO2_DB",
    "OPENCODE_CONFIG_DIR",
    "KILO2_CONFIG_DIR",
    "OPENCODE_HOME_DIR",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SERVER_PASSWORD",
    "KILO_SERVER_PASSWORD",
    "OPENCODE_CLIENT",
    "KILO_CLIENT",
    "KILO_PLATFORM",
    "KILO_AGENT_MANAGER_HOST",
    "KILO_TEST_HOME",
  ]
  await Bun.write(
    preload,
    `if (process.argv[1]?.endsWith("index.ts") && process.argv[2] === "session") console.error("KILO_DEV_ENV", JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((name) => [name, process.env[name]]))))\n`,
  )
  const real = path.join(root, "real")
  const profile = path.join(root, "profile")
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "../../../../script/dev-isolated.ts"),
      "session",
      "list",
      "--standalone",
      "--format",
      "json",
    ],
    {
      cwd: root,
      env: isolatedEnv(root, {
        BUN_OPTIONS: `--preload ${preload.replace(/[\s\\"']/g, (char) => `\\${char}`)}`,
        INIT_CWD: undefined,
        KILO_API_KEY: undefined,
        KILO_V2_PROFILE: profile,
        OPENCODE_DB: path.join(real, "opencode.db"),
        KILO2_DB: path.join(real, "kilo2.db"),
        OPENCODE_CONFIG_DIR: path.join(real, "config"),
        KILO2_CONFIG_DIR: path.join(real, "config"),
        OPENCODE_HOME_DIR: real,
        OPENCODE_SESSION_ID: "ses_parent",
        OPENCODE_SERVER_PASSWORD: "parent",
        KILO_SERVER_PASSWORD: "parent",
        OPENCODE_CLIENT: "vscode",
        KILO_CLIENT: "vscode",
        KILO_PLATFORM: "vscode",
        KILO_AGENT_MANAGER_HOST: "1",
        KILO_TEST_HOME: path.join(root, "test-home"),
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(code, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
    const line = stderr.split("\n").find((text) => text.startsWith("KILO_DEV_ENV "))
    expect(JSON.parse(line?.slice("KILO_DEV_ENV ".length) ?? "null"), stderr).toEqual({
      KILO_TEST_HOME: path.join(root, "test-home"),
    })
    expect(await Bun.file(path.join(profile, "data", "kilo2", "kilo2-local.db")).exists()).toBe(true)
    expect(await Bun.file(path.join(real, "opencode.db")).exists()).toBe(false)
    expect(await Bun.file(path.join(real, "kilo2.db")).exists()).toBe(false)
  } finally {
    child.kill()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test("isolated dev keeps the client identity of a client that starts its server with --stdio", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo dev-stdio-"))
  const preload = path.join(root, "preload.ts")
  await Bun.write(
    preload,
    'if (process.argv[1]?.endsWith("index.ts") && process.argv[2] === "serve") { console.error("KILO_DEV_ENV", JSON.stringify({ client: process.env.KILO_CLIENT, platform: process.env.KILO_PLATFORM, db: process.env.OPENCODE_DB ?? null })); process.exit(0) }\n',
  )
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, "../../../../script/dev-isolated.ts"),
      "serve",
      "--port",
      "0",
      "--stdio",
    ],
    {
      cwd: root,
      env: isolatedEnv(root, {
        BUN_OPTIONS: `--preload ${preload.replace(/[\s\\"']/g, (char) => `\\${char}`)}`,
        INIT_CWD: undefined,
        KILO_V2_PROFILE: path.join(root, "profile"),
        KILO_CLIENT: "vscode",
        KILO_PLATFORM: "vscode",
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect(code, stderr).toBe(0)
    const line = stderr.split("\n").find((text) => text.startsWith("KILO_DEV_ENV "))
    expect(JSON.parse(line?.slice("KILO_DEV_ENV ".length) ?? "null"), stderr).toEqual({
      client: "vscode",
      platform: "vscode",
      db: null,
    })
  } finally {
    child.kill()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
