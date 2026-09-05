import { expect, test } from "bun:test"
import { existsSync, statSync } from "node:fs"
import { chmod, mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { proveContract } from "./client-proof"
import { fixture, ready, run, start } from "./fixture"

for (const mode of ["source", "compiled"] as const) {
  test(`${mode}: generated client creates, admits and observes without executing`, async () => {
    const binary =
      mode === "compiled"
        ? path.join(
            process.env.KILO_CLI_TEST_ARTIFACT_DIR ?? path.resolve(import.meta.dir, "../dist"),
            process.platform === "win32" ? "kilo2.exe" : "kilo2",
          )
        : undefined
    await using input = await fixture(binary)
    const child = start(input, ["serve", "--port", "0"])
    const errors = new Response(child.stderr).text()
    try {
      const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
      const password = (await Bun.file(input.layout.password).text()).trim()
      expect(password).toMatch(/^[a-f0-9]{64}$/)
      expect(statSync(input.layout.password).mode & 0o077).toBe(0)
      expect(listening.text).not.toContain(password)
      const anonymous = OpenCode.make({ baseUrl: listening.value })
      await expect(anonymous.session.create({ location: { directory: input.cwd } })).rejects.toThrow()
      const denied = await fetch(`${listening.value}/api/session`, {
        method: "POST",
        body: JSON.stringify({ location: { directory: input.cwd } }),
        headers: { "content-type": "application/json" },
      })
      expect(denied.status).toBe(401)
      const proof = await proveContract(listening.value, password, input.cwd)
      expect(proof.admitted.sessionID).toBe(proof.session.id)
      expect(proof.inbox.some((item) => item.id === proof.admitted.id)).toBe(true)
      expect(proof.active).toEqual({})
      expect(proof.event.data.inboxID).toBe(proof.admitted.id)
      const headers = { authorization: `Basic ${btoa(`opencode:${password}`)}`, "content-type": "application/json" }
      for (const body of [
        { text: "must not execute" },
        { text: "must not execute", resume: true },
        { text: "no attachments", resume: false, files: [{ mime: "text/plain", url: "file:///etc/passwd" }] },
      ]) {
        const response = await fetch(`${listening.value}/api/session/${proof.session.id}/prompt`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
        expect(response.status).toBe(400)
      }
      for (const body of [
        {},
        { location: { directory: "relative" } },
        { location: { directory: input.cwd, workspaceID: "not-local" } },
      ]) {
        const response = await fetch(`${listening.value}/api/session`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
        expect(response.status).toBe(400)
      }
      for (const route of [
        "/api/pty",
        "/api/%70ty",
        "/openapi.json",
        "/api/config",
        `/api/session/${proof.session.id}/shell`,
        `/api/session/${proof.session.id}/resume`,
      ]) {
        for (const method of ["GET", "POST"]) {
          expect((await fetch(listening.value + route, { method, headers })).status).toBe(404)
        }
      }
      const client = OpenCode.make({ baseUrl: listening.value, headers })
      expect(await client.session.active()).toEqual({})
      expect((await client.session.inbox.list({ sessionID: proof.session.id })).length).toBe(1)
      child.kill("SIGTERM")
      expect(await child.exited, await errors).toBe(0)
      await expect(fetch(`${listening.value}/api/health`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
      const reopened = await run(input, ["serve"])
      expect(reopened.code).toBe(1)
      expect(reopened.stderr).toContain("populated session store")
    } finally {
      child.kill("SIGTERM")
      await child.exited
    }
  })
}

test("server rejects invalid ports before creating state", async () => {
  await using input = await fixture()
  for (const port of ["-1", "65536", "not-a-port"]) {
    const result = await run(input, ["serve", `--port=${port}`])
    expect(result.code).toBe(1)
    expect(existsSync(input.layout.database)).toBe(false)
  }
})

test("server refuses a symlinked password before touching protected data", async () => {
  await using input = await fixture()
  const original = path.join(input.env.XDG_CONFIG_HOME, "kilo/secret")
  await Bun.write(original, "do-not-read-or-change")
  await mkdir(input.layout.paths.state, { recursive: true })
  await symlink(original, input.layout.password)
  const result = await run(input, ["serve"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Refusing")
  expect(existsSync(input.layout.database)).toBe(false)
  expect(await Bun.file(original).text()).toBe("do-not-read-or-change")
})

test("server refuses public-readable authentication material", async () => {
  await using input = await fixture()
  const initialized = await run(input, ["init"])
  expect(initialized.code, initialized.stderr).toBe(0)
  await Bun.write(input.layout.password, "a".repeat(64))
  await chmod(input.layout.password, 0o644)
  const result = await run(input, ["serve"])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("mode 0600")
  expect(result.stdout).not.toContain("server ready")
})

test("the contract consumer bundles without Core or Server", async () => {
  await using input = await fixture()
  const directory = path.resolve(import.meta.dir, "..")
  const metadata = path.join(input.directory, "client-meta.json")
  const child = Bun.spawn(
    [
      process.execPath,
      "build",
      path.join(import.meta.dir, "client-proof.ts"),
      "--target=bun",
      "--packages=bundle",
      `--metafile=${metadata}`,
      `--outdir=${path.join(input.directory, "client")}`,
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, stdout + stderr).toBe(0)
  const result: { inputs: Record<string, unknown> } = await Bun.file(metadata).json()
  const inputs = Object.keys(result.inputs).map((name) => path.resolve(directory, name))
  for (const name of ["core", "server"]) {
    const root = path.resolve(directory, "..", name)
    expect(inputs.some((input) => input === root || input.startsWith(root + path.sep))).toBe(false)
  }
})
