import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../../fixture/fixture"

const root = path.resolve(import.meta.dir, "../../../..")

test("serve exits when an instance disposer stalls after SIGTERM", async () => {
  await using tmp = await tmpdir()
  const preload = path.join(tmp.path, "stall.ts")
  await Bun.write(
    preload,
    `import { registerDisposer } from ${JSON.stringify(path.join(root, "src/effect/instance-registry.ts"))}
registerDisposer(async () => {
  console.log("disposal-stalled")
  await Promise.withResolvers().promise
})
process.stdin.once("data", () => process.emit("SIGTERM"))
`,
  )
  const proc = Bun.spawn(
    [
      process.execPath,
      "--conditions=browser",
      "--preload=@opentui/solid/preload",
      `--preload=${preload}`,
      path.join(root, "src/index.ts"),
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: tmp.path,
      env: {
        ...process.env,
        HOME: tmp.path,
        KILO_TEST_HOME: tmp.path,
        XDG_CONFIG_HOME: path.join(tmp.path, "config"),
        XDG_DATA_HOME: path.join(tmp.path, "data"),
        XDG_STATE_HOME: path.join(tmp.path, "state"),
        XDG_CACHE_HOME: path.join(tmp.path, "cache"),
        KILO_CONFIG_CONTENT: "{}",
        KILO_AUTH_CONTENT: "{}",
        KILO_DISABLE_PROJECT_CONFIG: "1",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_DISABLE_MODELS_FETCH: "1",
        KILO_TELEMETRY_LEVEL: "off",
        KILO_PURE: "1",
        KILO_SERVER_PASSWORD: "",
        KILO_PARENT_PID: "",
        KILO_API_KEY: "",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  )
  const errors = new Response(proc.stderr).text()
  const ready = Promise.withResolvers<string>()
  const output = (async () => {
    const decoder = new TextDecoder()
    let text = ""
    for await (const chunk of proc.stdout) {
      text += decoder.decode(chunk, { stream: true })
      const url = text.match(/listening on (http:\/\/\S+)/)?.at(1)
      if (url) ready.resolve(url)
    }
    ready.reject(new Error(`Server exited before listening: ${text}`))
    return text + decoder.decode()
  })()
  // Exercise the child's real signal/timer loop; parent fake timers cannot drive it.
  const timeout = setTimeout(() => proc.kill("SIGKILL"), 25_000)
  try {
    const url = await ready.promise
    // Load a real instance so shutdown reaches the registered disposer.
    const response = await fetch(`${url}/path`, { headers: { "x-kilo-directory": tmp.path } })
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    // Windows cannot deliver POSIX signals; exercise the same handler via stdin there.
    if (process.platform === "win32") {
      await proc.stdin.write("shutdown")
      await proc.stdin.end()
    }
    if (process.platform !== "win32") proc.kill("SIGTERM")
    // A separate kill makes a missing backend deadline fail without leaking a child.
    const deadline = setTimeout(() => proc.kill("SIGKILL"), 10_000)
    try {
      const code = await proc.exited
      const stdout = await output
      expect(stdout).toContain("disposal-stalled")
      expect(code, `stdout:\n${stdout}\nstderr:\n${await errors}`).toBe(1)
    } finally {
      clearTimeout(deadline)
    }
  } finally {
    clearTimeout(timeout)
    proc.kill("SIGKILL")
    await proc.exited
    await output
    await errors
  }
}, 30_000)
