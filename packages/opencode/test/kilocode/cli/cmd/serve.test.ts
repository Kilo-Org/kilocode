import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../../fixture/fixture"

const root = path.resolve(import.meta.dir, "../../../..")
const entry = path.join(root, "src/index.ts")

function serve(dir: string, args: string[], extra: Record<string, string>) {
  return Bun.spawn(
    [
      process.execPath,
      "--conditions=browser",
      "--preload=@opentui/solid/preload",
      entry,
      "serve",
      ...args,
      "--port",
      "0",
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        HOME: dir,
        XDG_CONFIG_HOME: path.join(dir, ".config"),
        XDG_DATA_HOME: path.join(dir, ".local/share"),
        XDG_STATE_HOME: path.join(dir, ".local/state"),
        XDG_CACHE_HOME: path.join(dir, ".cache"),
        KILO_TEST_HOME: dir,
        KILO_CONFIG_CONTENT: "{}",
        KILO_DISABLE_PROJECT_CONFIG: "1",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_DISABLE_MODELS_FETCH: "1",
        KILO_PURE: "1",
        ...extra,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  )
}

// Reads stdout until `marker` appears, runs `use` while the server is still up, then stops it.
async function listen(proc: ReturnType<typeof serve>, marker: string, use?: (output: string) => Promise<void>) {
  const errors = new Response(proc.stderr).text()
  // Cold CLI start from source can exceed 15s on loaded Windows CI runners.
  const timeout = setTimeout(() => proc.kill(), 45_000)
  const output = await (async () => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let text = ""

    while (!text.includes(marker)) {
      const chunk = await reader.read()
      if (chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
    }

    reader.releaseLock()
    const output = text + decoder.decode()
    if (use && text.includes(marker)) await use(output)
    return output
  })().finally(async () => {
    clearTimeout(timeout)
    proc.kill()
    await proc.exited
  })
  return { output, stderr: await errors }
}

test("prints the local IPv6 URL for wildcard binds", async () => {
  await using tmp = await tmpdir()
  const proc = serve(tmp.path, ["--hostname", "::"], { KILO_SERVER_PASSWORD: "test" })
  const { output, stderr } = await listen(proc, "  Local:")

  expect(output, `stdout:\n${output}\nstderr:\n${stderr}`).toMatch(
    /kilo server listening on http:\/\/\[::\]:(\d+)\r?\n  Local:   http:\/\/\[::1\]:\1(?:\r?\n|$)/,
  )
}, 60_000)

test("reads the Basic Auth password from KILO_SERVER_PASSWORD_FILE", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "password")
  await Bun.write(file, "file-secret\n")
  const proc = serve(tmp.path, [], { KILO_SERVER_PASSWORD_FILE: file })
  const status: Record<string, number> = {}
  const { output, stderr } = await listen(proc, "kilo server listening", async (text) => {
    const url = text.match(/listening on (http:\/\/\S+)/)?.[1]
    for (const [name, auth] of Object.entries({ none: undefined, wrong: "kilo:nope", right: "kilo:file-secret" })) {
      const headers = auth ? { Authorization: `Basic ${Buffer.from(auth).toString("base64")}` } : undefined
      status[name] = (await fetch(`${url}/path`, { headers })).status
    }
  })

  expect(output, `stdout:\n${output}\nstderr:\n${stderr}`).not.toContain("server is unsecured")
  expect(status).toEqual({ none: 401, wrong: 401, right: 200 })
}, 30_000)

test("fails to start when KILO_SERVER_PASSWORD_FILE is empty", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "password")
  await Bun.write(file, "\n")
  const proc = serve(tmp.path, [], { KILO_SERVER_PASSWORD_FILE: file })
  const { output, stderr } = await listen(proc, "kilo server listening")

  expect(await proc.exited).toBe(1)
  expect(output).not.toContain("kilo server listening")
  expect(stderr).toContain(`KILO_SERVER_PASSWORD_FILE (${file}) is empty`)
}, 30_000)
