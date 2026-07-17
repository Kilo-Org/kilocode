import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../../fixture/fixture"

const root = path.resolve(import.meta.dir, "../../../..")
const entry = path.join(root, "src/index.ts")
const tuiPreload = import.meta.resolve("@opentui/solid/preload")

test("prints the local IPv6 URL for wildcard binds", async () => {
  await using tmp = await tmpdir()
  const proc = Bun.spawn(
    [
      process.execPath,
      "--conditions=browser",
      `--preload=${tuiPreload}`,
      entry,
      "serve",
      "--hostname",
      "::",
      "--port",
      "0",
    ],
    {
      cwd: tmp.path,
      env: {
        ...process.env,
        HOME: tmp.path,
        XDG_CONFIG_HOME: path.join(tmp.path, ".config"),
        XDG_DATA_HOME: path.join(tmp.path, ".local/share"),
        XDG_STATE_HOME: path.join(tmp.path, ".local/state"),
        XDG_CACHE_HOME: path.join(tmp.path, ".cache"),
        KILO_TEST_HOME: tmp.path,
        KILO_CONFIG_CONTENT: "{}",
        KILO_DISABLE_PROJECT_CONFIG: "1",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_DISABLE_MODELS_FETCH: "1",
        KILO_PURE: "1",
        KILO_SERVER_PASSWORD: "test",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  )
  const errors = new Response(proc.stderr).text()
  const timeout = setTimeout(() => proc.kill(), 15_000)
  const output = await (async () => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let text = ""

    while (!text.includes("  Local:")) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }

    reader.releaseLock()
    return text + decoder.decode()
  })().finally(async () => {
    clearTimeout(timeout)
    proc.kill()
    await proc.exited
  })
  const stderr = await errors

  expect(output, `stdout:\n${output}\nstderr:\n${stderr}`).toMatch(
    /kilo server listening on http:\/\/\[::\]:(\d+)\r?\n  Local:   http:\/\/\[::1\]:\1(?:\r?\n|$)/,
  )
}, 30_000)
