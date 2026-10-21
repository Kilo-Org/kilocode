#!/usr/bin/env bun

// Smoke test for a compiled Kilo host executable (packages/kilo-cli/script/build.ts). Usage:
//   bun script/kilocode/smoke-host.ts <path to the kilo executable>
//
// It runs the executable in an isolated profile (its own HOME and XDG directories, a free service port) and fails
// unless the executable
// - reports a version and is named `kilo`, so it is not the upstream `opencode` entry;
// - keeps all of its data in `kilo2` and never creates an `opencode` directory (U-E1-01, so it can sit next to v1);
// - starts the background service from itself, reports its URL and stops it again.
// The service respawns the executable with `serve --service`, which exercises the host's serve handler too.
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const binary = process.argv[2]
if (!binary) throw new Error("Usage: bun script/kilocode/smoke-host.ts <path to the kilo executable>")
if (!(await Bun.file(binary).exists())) throw new Error(`Missing executable: ${binary}`)

const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-smoke-")))
const env = {
  ...process.env,
  HOME: root,
  USERPROFILE: root,
  OPENCODE_TEST_HOME: root,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
}

async function run(args: string[], timeout: number) {
  const child = Bun.spawn([path.resolve(binary), ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), timeout)
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  clearTimeout(timer)
  const code = await child.exited
  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}

async function ok(args: string[], timeout = 60_000) {
  const result = await run(args, timeout)
  if (result.code !== 0) throw new Error(`\`kilo ${args.join(" ")}\` exited with ${result.code}:\n${result.stderr}`)
  return result.stdout
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

let failure: unknown
try {
  const version = await ok(["--version"])
  if (!version.startsWith("kilo ")) throw new Error(`Expected the version line to start with "kilo ", got: ${version}`)

  // A private port, so a service that is already running on this machine (the default port) cannot interfere.
  await ok(["service", "set", "port", String(await freePort())])
  const url = await ok(["service", "start"], 90_000)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error(`Unexpected service URL: ${url}`)
  const status = await ok(["service", "status"])
  if (status !== url) throw new Error(`Service status "${status}" does not match the started service "${url}"`)

  const directories = await readdir(path.join(root, "data"))
  if (!directories.includes("kilo2")) throw new Error(`No kilo2 data directory. Found: ${directories.join(", ")}`)
  if (directories.includes("opencode")) throw new Error("The host wrote to the upstream opencode data directory")
  console.log(`ok: ${version}, service ${url}, data in kilo2`)
} catch (error) {
  failure = error
} finally {
  // Always stop the service, also after a failed check: it would hold the port and the data directory.
  await run(["service", "stop"], 30_000).catch(() => undefined)
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : failure)
  process.exit(1)
}
