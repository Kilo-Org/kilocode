import { describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { lstatSync, statSync } from "node:fs"
import { chmod, link, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { defaultConfig, resolveConfig, startActivityExporter, type EventSubscriberClient } from "../src/telemetry"
import { disabled, input, read, resolve, write, type Settings } from "../src/telemetry-settings"

async function temporaryDirectory() {
  return await mkdtemp(path.join(os.tmpdir(), "kilo-telemetry-settings-test-"))
}

async function spawnChild(args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "fixtures/telemetry-settings-child.ts"), ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

const enabledSettings: Settings = { version: 1, enabled: true, endpoint: "http://127.0.0.1:4318" }

describe("telemetry settings persistence", () => {
  test("defaults to disabled consent when the settings file does not exist", async () => {
    const directory = await temporaryDirectory()
    try {
      const settings = await read(path.join(directory, "telemetry.json"))
      expect(settings).toEqual({ version: 1, enabled: false })
      expect(settings.enabled).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("persists explicit consent and config, restart-safe across a fresh process", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "nested", "telemetry.json")
      const result = await spawnChild(["write", file, "http://127.0.0.1:4318"])
      expect(result.code).toBe(0)

      const settings = await read(file)
      expect(settings.enabled).toBe(true)
      expect(settings.endpoint).toBe("http://127.0.0.1:4318")
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700)

      const restart = await spawnChild(["read", file])
      expect(restart.code).toBe(0)
      expect(JSON.parse(restart.stdout)).toEqual({
        version: 1,
        enabled: true,
        endpoint: "http://127.0.0.1:4318",
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("round-trips full settings and drops unknown fields at the file boundary", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "telemetry.json")
      const settings: Settings = {
        version: 1,
        enabled: true,
        endpoint: "http://127.0.0.1:4318",
        headers: "api-key=test",
        client: "kilo-cli",
        channel: "preview",
      }
      await write(file, settings)
      expect(await read(file)).toEqual(settings)

      const tampered = `${JSON.stringify(settings).slice(0, -1)},"token":"secret-sentinel-9988","password":"hunter2"}`
      await writeFile(file, tampered)
      const recovered = await read(file)
      expect(recovered.enabled).toBe(true)
      expect(JSON.stringify(recovered)).not.toContain("secret-sentinel-9988")
      expect(JSON.stringify(recovered)).not.toContain("hunter2")
      expect(JSON.stringify(input(recovered))).not.toContain("secret-sentinel-9988")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects symlinked, hardlinked, fifo, and public-readable files as disabled without hanging", async () => {
    const directory = await temporaryDirectory()
    try {
      const foreign = path.join(directory, "foreign.json")
      await writeFile(foreign, JSON.stringify(enabledSettings), { mode: 0o600 })

      const linked = path.join(directory, "linked.json")
      await symlink(foreign, linked)
      expect(await read(linked)).toEqual(disabled)

      const shared = path.join(directory, "shared.json")
      await writeFile(shared, JSON.stringify(enabledSettings), { mode: 0o600 })
      await link(shared, path.join(directory, "shared-other.json"))
      expect(await read(shared)).toEqual(disabled)

      const fifo = path.join(directory, "fifo.json")
      const fifoCreate = spawnSync("mkfifo", [fifo])
      if (fifoCreate.status === 0) {
        expect(await read(fifo)).toEqual(disabled)
      } else {
        console.warn("Skipping fifo rejection: mkfifo unavailable")
      }

      const loose = path.join(directory, "loose.json")
      await writeFile(loose, JSON.stringify(enabledSettings), { mode: 0o644 })
      expect(await read(loose)).toEqual(disabled)
      await chmod(loose, 0o600)
      expect(await read(loose)).toEqual(enabledSettings)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("bounds reads on oversized settings files", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "oversized.json")
      await writeFile(file, "a".repeat(64 * 1024 + 1024), { mode: 0o600 })
      expect(await read(file)).toEqual(disabled)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("fails closed on corrupt or schema-invalid settings files", async () => {
    const directory = await temporaryDirectory()
    try {
      const corrupt = path.join(directory, "corrupt.json")
      await writeFile(corrupt, "{not json at all", { mode: 0o600 })
      expect(await read(corrupt)).toEqual(disabled)

      const invalid = path.join(directory, "invalid.json")
      await writeFile(invalid, JSON.stringify({ version: 2, enabled: true, endpoint: "http://127.0.0.1:4318" }), {
        mode: 0o600,
      })
      expect(await read(invalid)).toEqual(disabled)

      const wrongType = path.join(directory, "wrong-type.json")
      await writeFile(wrongType, JSON.stringify({ version: 1, enabled: "yes" }), { mode: 0o600 })
      expect(await read(wrongType)).toEqual(disabled)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("refuses writing schema-invalid settings", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "telemetry.json")
      await expect(write(file, { version: 2, enabled: true } as unknown as Settings)).rejects.toThrow(
        `Invalid telemetry settings: ${file}`,
      )
      expect(statSync(file, { throwIfNoEntry: false })).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("refuses replacing symlinked, shared, or non-regular existing files", async () => {
    const directory = await temporaryDirectory()
    try {
      const foreign = path.join(directory, "foreign.json")
      const foreignContent = JSON.stringify({ version: 1, enabled: false })
      await writeFile(foreign, foreignContent, { mode: 0o600 })

      const linked = path.join(directory, "linked.json")
      await symlink(foreign, linked)
      await expect(write(linked, enabledSettings)).rejects.toThrow(
        `Refusing to replace non-regular telemetry settings: ${linked}`,
      )
      expect(lstatSync(linked).isSymbolicLink()).toBe(true)
      expect(await Bun.file(foreign).text()).toEqual(foreignContent)

      const shared = path.join(directory, "shared.json")
      await writeFile(shared, foreignContent, { mode: 0o600 })
      await link(shared, path.join(directory, "shared-other.json"))
      await expect(write(shared, enabledSettings)).rejects.toThrow(
        `Refusing to replace non-regular telemetry settings: ${shared}`,
      )
      expect(statSync(shared).nlink).toBe(2)
      expect(await Bun.file(shared).text()).toEqual(foreignContent)

      const fifo = path.join(directory, "fifo.json")
      const fifoCreate = spawnSync("mkfifo", [fifo])
      if (fifoCreate.status === 0) {
        await expect(write(fifo, enabledSettings)).rejects.toThrow(
          `Refusing to replace non-regular telemetry settings: ${fifo}`,
        )
        expect(lstatSync(fifo).isFIFO()).toBe(true)
      } else {
        console.warn("Skipping fifo write refusal: mkfifo unavailable")
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("telemetry settings resolve", () => {
  test("missing settings file defers consent entirely to the environment", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "telemetry.json")
      const envOptIn = await resolve(file, {
        KILO_TELEMETRY_ENABLED: "1",
        KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318",
      })
      expect(envOptIn.enabled).toBe(true)
      expect(envOptIn.endpoint).toBe("http://127.0.0.1:4318")

      const envOff = await resolve(file, {})
      expect(envOff).toEqual(defaultConfig)
      expect(envOff.enabled).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("declined, corrupt, or foreign consent forces off over environment opt-in", async () => {
    const directory = await temporaryDirectory()
    try {
      const envOptIn = {
        KILO_TELEMETRY_ENABLED: "1",
        KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318",
      }

      const declined = path.join(directory, "declined.json")
      await writeFile(declined, JSON.stringify({ version: 1, enabled: false }), { mode: 0o600 })
      expect((await resolve(declined, envOptIn)).enabled).toBe(false)

      const corrupt = path.join(directory, "corrupt.json")
      await writeFile(corrupt, "{not json", { mode: 0o600 })
      expect((await resolve(corrupt, envOptIn)).enabled).toBe(false)

      const target = path.join(directory, "target.json")
      await writeFile(target, JSON.stringify(enabledSettings), { mode: 0o600 })
      const linked = path.join(directory, "linked.json")
      await symlink(target, linked)
      expect((await resolve(linked, envOptIn)).enabled).toBe(false)
      expect((await resolve(linked, envOptIn)).endpoint).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("persisted consent composes with file and environment endpoints", async () => {
    const directory = await temporaryDirectory()
    try {
      const file = path.join(directory, "telemetry.json")
      await writeFile(file, JSON.stringify({ version: 1, enabled: true }), { mode: 0o600 })
      const fromEnv = await resolve(file, { KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4319" })
      expect(fromEnv.enabled).toBe(true)
      expect(fromEnv.endpoint).toBe("http://127.0.0.1:4319")

      await writeFile(file, JSON.stringify({ version: 1, enabled: true, endpoint: "http://127.0.0.1:4318" }), {
        mode: 0o600,
      })
      const fromFile = await resolve(file, { KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4319" })
      expect(fromFile.enabled).toBe(true)
      expect(fromFile.endpoint).toBe("http://127.0.0.1:4318")

      const noEndpoint = await resolve(file, {})
      expect(noEndpoint.enabled).toBe(true)
      expect(noEndpoint.endpoint).toBe("http://127.0.0.1:4318")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("explicit input bridge keeps resolveConfig precedence for direct callers", async () => {
    const config = resolveConfig(input(disabled), { KILO_TELEMETRY_ENABLED: "1" })
    expect(config).toEqual(defaultConfig)
  })
})

describe("telemetry settings drive the activity exporter end to end", () => {
  let server: Server
  let port: number
  let receivedBodies: string[]

  async function startCollector() {
    receivedBodies = []
    server = createServer((req, res) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => {
        if (req.url === "/v1/logs" && body) {
          receivedBodies.push(body)
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({}))
      })
    })
    await new Promise<void>((done) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address && typeof address !== "string") port = address.port
        done()
      })
    })
  }

  async function stopCollector() {
    await new Promise<void>((done) => server.close(() => done()))
  }

  const mockClient: EventSubscriberClient = {
    event: {
      async *subscribe() {
        yield { type: "server.connected" }
        yield { type: "session.created" }
        yield { type: "skill.updated" }
      },
    },
  }

  test("persisted disabled consent emits zero requests", async () => {
    const directory = await temporaryDirectory()
    try {
      await startCollector()
      const file = path.join(directory, "telemetry.json")
      await write(file, { version: 1, enabled: false })
      const config = await resolve(file, { KILO_TELEMETRY_ENDPOINT: `http://127.0.0.1:${port}` })
      const exporter = startActivityExporter(mockClient, config, {})
      await new Promise((r) => setTimeout(r, 50))
      await exporter.stop()
      expect(receivedBodies).toHaveLength(0)
    } finally {
      await stopCollector()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("persisted enabled consent exports only exportable event names to the collector", async () => {
    const directory = await temporaryDirectory()
    try {
      await startCollector()
      const file = path.join(directory, "telemetry.json")
      await write(file, { version: 1, enabled: true })
      const config = await resolve(file, {
        KILO_TELEMETRY_ENDPOINT: `http://127.0.0.1:${port}`,
        KILO_TELEMETRY_HEADERS: "api-key=collector-credential-4455",
      })
      const exporter = startActivityExporter(mockClient, config, {})
      await new Promise((r) => setTimeout(r, 100))
      await exporter.stop()

      expect(receivedBodies).toHaveLength(2)
      const exportedTypes = receivedBodies.map(
        (body) => JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,
      )
      expect(exportedTypes).toEqual(["server.connected", "session.created"])

      const combinedRawText = receivedBodies.join("\n")
      expect(combinedRawText).not.toContain("skill.updated")
      expect(combinedRawText).not.toContain("collector-credential-4455")
    } finally {
      await stopCollector()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
