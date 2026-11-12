import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const host = path.dirname(import.meta.dir)
const login = new Set(["KILO_API_KEY", "KILOCODE_TOKEN", "KILO_AUTH_CONTENT", "KILO_ORG_ID", "KILO_AI_GATEWAY_URL"])

// One-shot commands that call a Kilo RPC first, on a server they just started: the Location's plugins are still
// activating, and the server answers `rpc.unavailable` until they are registered. HOME and XDG are isolated, the
// command runs signed out, and a local stand-in answers the Kilo API.
async function run(root: string, api: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, path.join(host, "src/index.ts"), ...args], {
    // `kilo remote` hosts its working directory.
    cwd: root,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !login.has(key))),
      // The working directory has no bunfig.toml, so name the preload that compiles the TUI modules the CLI imports.
      BUN_OPTIONS: `--preload ${path.join(host, "src/branding/preload.ts").replace(/[\s\\"']/g, (char) => `\\${char}`)}`,
      HOME: root,
      USERPROFILE: root,
      OPENCODE_TEST_HOME: root,
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      KILO_API_URL: api,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  // A signed-in `kilo remote` waits for commands until interrupted; never let it hold the test.
  const timer = setTimeout(() => child.kill(), 45_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)
  return { stdout, stderr, code }
}

test("kilo sync status reads the state from a server it just started", async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-cold-sync-")))
  try {
    const result = await run(root, backend.url, "sync", "status", "--standalone", root)
    expect(result.stdout, result.stderr).toContain("Session sync: disabled")
    expect(result.code, result.stderr).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test("kilo remote passes the handshake on a server it just started", async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-cold-remote-")))
  try {
    const result = await run(root, backend.url, "remote")
    const output = result.stdout + result.stderr
    expect(output).not.toContain("RPC is unavailable")
    // Signed out, the host stops after the handshake, at the session sync check.
    expect(output).toContain("Sign in to Kilo and enable session sync before starting a remote host")
    expect(result.code, output).not.toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
