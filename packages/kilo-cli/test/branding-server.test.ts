import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brandingPlugin } from "../src/branding/plugin"
import { repo } from "./fixtures/branding-run"

const entry = path.join(import.meta.dir, "../src/index.ts")
const modules = ["handlers/server.ts", "handlers/persistent-pty.ts", "process.ts"].map((file) =>
  path.join(repo, "packages/server/src", file),
)
const upstream = ["Run `opencode pair`", "Run `opencode service restart`", "after OpenCode's terminal service restarts"]
const kilo = ["Run `kilo2 pair`", "Run `kilo2 service restart`", "after Kilo's terminal service restarts"]

// The compiled build bundles the server through the same plugin (script/build.ts), so the loader's path filter has
// to match the server modules in a bundle as well as in a source run.
for (const hosted of [false, true]) {
  test(`a bundle of the server modules ${hosted ? "names Kilo" : "keeps upstream wording"}`, async () => {
    const result = await Bun.build({
      entrypoints: modules,
      plugins: hosted ? [brandingPlugin] : [],
      packages: "external",
      target: "bun",
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    const output = (await Promise.all(result.outputs.map((item) => item.text()))).join("\n")
    for (const text of hosted ? kilo : upstream) expect(output).toContain(text)
    for (const text of hosted ? upstream : kilo) expect(output).not.toContain(text)
    // The basic-auth username is an identity the clients send, in both.
    expect(output).toContain('username: "opencode"')
  }, 60_000)
}

// The host entry from source, as `bun dev` runs it: a browser that opens a used pairing link reads the Kilo command.
test("the host's server names the Kilo command when a pairing link expired", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-branding-server-")))
  using backend = fixture()
  await mkdir(path.join(root, "tmp"))
  const child = Bun.spawn([process.execPath, entry, "serve", "--stdio"], {
    // The package directory, so its bunfig.toml preload installs the branding loader.
    cwd: path.dirname(import.meta.dir),
    env: {
      // The test preload isolates XDG for in-process tests; a host boot must not inherit it, or any directory override.
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("XDG_") && !/^(OPENCODE|KILO2?)_/.test(key)),
      ),
      BUN_OPTIONS: "",
      HOME: root,
      USERPROFILE: root,
      TMPDIR: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_SERVER_PASSWORD: "secret",
      KILO_API_URL: backend.url,
    },
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
    const response = await fetch(new URL("/auth/connect/not-a-code", url), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe(
      "This pairing link expired or was already used. Run `kilo2 pair` to get a new one.",
    )
  } finally {
    // The server treats EOF on stdin as the end of its lease.
    child.stdin.end()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
