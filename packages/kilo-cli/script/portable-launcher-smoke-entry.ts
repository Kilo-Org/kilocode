// Portable real-launcher smoke entrypoint, bundled into the artifact by build-portable.ts as
// script/portable-launcher-smoke-entry.js. It proves the SHIPPED kilo2 LAUNCHER BINARY itself
// boots the host — NOT an in-process launch() call (which bypasses the launcher). `--version`
// alone is insufficient: this drives the real supported host-boot invocation end to end.
//
//   1. SPAWN the relocated artifact's actual kilo2 launcher (sh script -> bundled bun +
//      src/tui-preview.js) with the `serve` host-boot command, in an isolated HOME/XDG.
//   2. READINESS: the launcher prints `URL: <loopback>` + `Password file: <path>` once the host
//      is serving; we then poll the public `/api/health` readiness API (Basic auth from the
//      printed password file) until it answers 200 — proving the host is actually up, not just
//      that the launcher started.
//   3. GRACEFUL STOP: SIGTERM the launcher; assert it exits cleanly (no hang, no orphan: the
//      launcher process is gone afterwards).
//
// Loopback only; no network, no credentials, no in-process launch().
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { requireRuntime } from "../src/runtime"

requireRuntime()

const artifactRoot = process.env.KILO_PORTABLE_ARTIFACT_ROOT
assert(artifactRoot, "KILO_PORTABLE_ARTIFACT_ROOT must point at the relocated artifact")

const launcher = `${artifactRoot}/kilo2`

async function main() {
  // 1) Spawn the real kilo2 launcher binary with the serve host-boot command.
  const home = process.env.HOME
  const tmp = process.env.TMPDIR ?? "/tmp"
  const child = Bun.spawn([launcher, "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    // The launcher (sh script + bundled bun) and the host it boots need an isolated HOME/XDG,
    // which the runner already provides to this entry; forward it to the launcher child.
    env: {
      PATH: "/usr/bin:/bin",
      HOME: home,
      USERPROFILE: home,
      TMPDIR: tmp,
      TMP: tmp,
      TEMP: tmp,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      TERM: "dumb",
    },
    timeout: 60000,
    killSignal: "SIGTERM",
  })
  let url: string | undefined
  let passwordFile: string | undefined
  let stopSent = false
  try {
    // 2) Wait for the launcher to report its serving URL + password file on stdout. Accumulate
    //    the FULL stdout stream continuously from spawn (a per-read timeout race can lose bytes
    //    in nested-bun contexts); poll the accumulated text for the URL + password file.
    let out = ""
    const accumulate = (async () => {
      const reader = child.stdout.getReader()
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        out += new TextDecoder().decode(next.value)
      }
    })()
    const deadline = Date.now() + 120000
    while (Date.now() < deadline && (!url || !passwordFile)) {
      await Bun.sleep(100)
      url ??= out.match(/URL: (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      passwordFile ??= out.match(/Password file: (.+)/)?.[1]?.trim()
    }
    if (!url || !passwordFile) {
      const stderr = await new Response(child.stderr).text()
      throw new Error(`launcher must print a serving URL; stdout so far:\n${out}\nstderr:\n${stderr}`)
    }

    // Readiness: poll /api/health with Basic auth read from the printed password file.
    const password = (await readFile(passwordFile, "utf8")).trim()
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    let healthy = false
    for (let attempt = 0; attempt < 100 && !healthy; attempt++) {
      healthy = await fetch(`${url}/api/health`, { headers: { authorization: auth } })
        .then((r) => r.status === 200)
        .catch(() => false)
      if (!healthy) await Bun.sleep(100)
    }
    assert(healthy, `launcher host must answer /api/health 200 at ${url}`)

    // 3) Graceful stop: SIGTERM the launcher; it must exit cleanly (not hang).
    stopSent = true
    child.kill("SIGTERM")
    const code = await child.exited
    assert(code !== undefined, "launcher must exit after SIGTERM")
    // Orphan check: the launcher process must be gone.
    const alive = await Bun.spawn(["kill", "-0", String(child.pid)], { stdout: "ignore", stderr: "ignore" }).exited
    assert(alive !== 0, `launcher process ${child.pid} must be dead after SIGTERM`)
    return { url, healthy: true, stoppedCleanly: true }
  } finally {
    if (!stopSent) child.kill("SIGTERM")
    await child.exited
  }
}

try {
  const result = await main()
  console.log(`KILO_PORTABLE_LAUNCHER_SMOKE_OK ${JSON.stringify(result)}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
