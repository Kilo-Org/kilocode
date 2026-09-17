import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const action = Bun.YAML.parse(
  await Bun.file(new URL("../../.github/actions/setup-linux-sandbox/action.yml", import.meta.url)).text(),
)
assert(action && typeof action === "object" && "runs" in action)
const runs = action.runs
assert(runs && typeof runs === "object" && "steps" in runs && Array.isArray(runs.steps))
const step: unknown = runs.steps.find(
  (step: unknown) => step && typeof step === "object" && "name" in step && step.name === "Setup Zig",
)
assert(step && typeof step === "object" && "run" in step && typeof step.run === "string")
const shell = step.run
const name = "zig-linux-x86_64-0.14.0"

describe.skipIf(process.platform === "win32")("Linux sandbox toolchain setup", () => {
  let root: string
  let archive: ArrayBuffer
  let tampered: ArrayBuffer

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "kilo-zig-test-"))
    await mkdir(path.join(root, name))
    await Bun.write(path.join(root, name, "zig"), "verified fixture")
    const proc = Bun.spawn(["tar", "-cJf", path.join(root, "fixture.tar.xz"), "-C", root, name])
    expect(await proc.exited).toBe(0)
    archive = await Bun.file(path.join(root, "fixture.tar.xz")).arrayBuffer()
    await Bun.write(path.join(root, name, "zig"), "tampered fixture")
    const altered = Bun.spawn(["tar", "-cJf", path.join(root, "tampered.tar.xz"), "-C", root, name])
    expect(await altered.exited).toBe(0)
    tampered = await Bun.file(path.join(root, "tampered.tar.xz")).arrayBuffer()
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function run(mirrors: string[], cached?: "valid" | "invalid") {
    const dir = await mkdtemp(path.join(root, "runner-"))
    const file = path.join(dir, `${name}.tar.xz`)
    const output = path.join(dir, "path")
    if (cached) await Bun.write(file, cached === "valid" ? archive : tampered)
    const requests: string[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch(request) {
        const route = new URL(request.url).pathname.split("/").at(1)!
        requests.push(route)
        if (route === "good") return new Response(archive)
        if (route === "bad") return new Response(tampered)
        if (route === "large") return new Response(new Uint8Array(49091961))
        if (route === "slow") return new Response(new ReadableStream())
        return new Response("unavailable", { status: 503 })
      },
    })
    try {
      // Run the action's real shell with real curl, checksum verification, and tar.
      const proc = Bun.spawn(["bash", "-e", "-o", "pipefail", "-c", shell], {
        env: {
          ...process.env,
          RUNNER_TEMP: dir,
          GITHUB_PATH: output,
          ZIG_SHA256: new Bun.CryptoHasher("sha256").update(archive).digest("hex"),
          ZIG_MIRRORS: mirrors.map((mirror) => `${server.url}${mirror}`).join("\n"),
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 25000,
      })
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return {
        code,
        log: stdout + stderr,
        requests,
        extracted: await Bun.file(path.join(dir, name, "zig")).exists(),
        cached: await Bun.file(file).exists(),
        installed: (await Bun.file(output).exists()) && (await Bun.file(output).text()) === `${dir}/${name}\n`,
      }
    } finally {
      await server.stop(true)
    }
  }

  test("falls back on HTTP errors, oversized responses, and altered archives", async () => {
    const result = await run(["missing", "large", "bad", "good"])
    expect(result.code, result.log).toBe(0)
    expect(result.requests).toEqual(["missing", "large", "bad", "good"])
    expect(result.extracted).toBe(true)
    expect(result.installed).toBe(true)
  })

  test("uses a verified cached archive without network access", async () => {
    const result = await run(["missing"], "valid")
    expect(result.code, result.log).toBe(0)
    expect(result.requests).toEqual([])
    expect(result.installed).toBe(true)
  })

  test("replaces a corrupt cached archive", async () => {
    const result = await run(["good"], "invalid")
    expect(result.code, result.log).toBe(0)
    expect(result.requests).toEqual(["good"])
    expect(result.installed).toBe(true)
  })

  test("fails without extracting or retaining unverified archives", async () => {
    const result = await run(["missing", "bad"])
    expect(result.code).not.toBe(0)
    expect(result.log).toContain("Could not obtain the verified Zig 0.14.0 archive")
    expect(result.extracted).toBe(false)
    expect(result.cached).toBe(false)
    expect(result.installed).toBe(false)
  })

  test("abandons a stalled mirror and tries the next source", async () => {
    const result = await run(["slow", "good"])
    expect(result.code, result.log).toBe(0)
    expect(result.requests).toEqual(["slow", "good"])
    expect(result.installed).toBe(true)
  }, 30000)
})
