import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const entry = path.join(import.meta.dir, "../src/index.ts")

// Service smoke for the host: the host entry runs the upstream `service` commands, the background service it
// spawns is the host again (`serve --service`), and that server has the Kilo plugins. HOME and XDG are isolated.
test("the background service the host starts is the host, with the Kilo plugins", async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-host-service-")))
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    OPENCODE_TEST_HOME: root,
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    KILO_API_URL: backend.url,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  }
  const cli = async (...args: string[]) => {
    // The package directory, so its bunfig.toml preload compiles the TUI modules the CLI imports (as in
    // packages/cli/test). The service inherits it.
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
  try {
    // A free port, so the test does not meet another service on the default port.
    const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
    const port = probe.port
    probe.stop(true)
    await cli("service", "set", "port", String(port))

    const url = await cli("service", "start")
    expect(url).toBe(`http://127.0.0.1:${port}`)
    const authorization = `Basic ${btoa(`opencode:${await cli("service", "get", "password")}`)}`
    // The upstream built-in list has no Kilo plugin, so this also proves the service runs the host entry.
    // The first request boots the location; its plugins activate shortly after.
    const plugins = async (remaining = 100): Promise<unknown[]> => {
      const body = await fetch(new URL(`/api/plugin?location[directory]=${encodeURIComponent(root)}`, url), {
        headers: { authorization },
        signal: AbortSignal.timeout(10_000),
      }).then((response) => response.json())
      if (body.data.length > 0 || remaining === 0) return body.data
      await Bun.sleep(100)
      return plugins(remaining - 1)
    }
    expect(await plugins()).toContainEqual(expect.objectContaining({ id: "kilocode.gateway", source: { type: "sdk" } }))
  } finally {
    await cli("service", "stop").catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
