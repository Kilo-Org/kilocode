import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import path from "node:path"
import { Effect } from "effect"
import { OpenCode } from "@opencode-ai/client"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import {
  defaultConfig,
  EXPORTABLE_EVENT_TYPES,
  exportActivity,
  LIFECYCLE_EVENT_TYPES,
  resolveConfig,
  SAFE_EVENT_TYPES,
  startActivityExporter,
  type EventSubscriberClient,
} from "../src/telemetry"
import { fixture, ready } from "./fixture"

describe("telemetry configuration", () => {
  test("defaults to disabled without explicit opt-in", () => {
    const config = resolveConfig({}, {})
    expect(config.enabled).toBe(false)
    expect(config.client).toBe("kilo-cli")
    expect(config.channel).toBe("interactive")
    expect(config.endpoint).toBeUndefined()
  })

  test("does not enable when endpoint is set in environment without opt-in", () => {
    const config = resolveConfig(
      {},
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318",
      },
    )
    expect(config.enabled).toBe(false)
    expect(config.endpoint).toBeUndefined()
  })

  test("does not enable when explicitly set to enabled: false", () => {
    const config = resolveConfig(
      { enabled: false, endpoint: "http://127.0.0.1:4318" },
      { KILO_TELEMETRY_ENABLED: "1" },
    )
    expect(config.enabled).toBe(false)
    expect(config.endpoint).toBeUndefined()
  })

  test("does not enable when KILO_TELEMETRY_ENABLED is false or 0", () => {
    const config1 = resolveConfig(
      {},
      { KILO_TELEMETRY_ENABLED: "0", KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318" },
    )
    expect(config1.enabled).toBe(false)

    const config2 = resolveConfig(
      {},
      { KILO_TELEMETRY_ENABLED: "false", KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318" },
    )
    expect(config2.enabled).toBe(false)
  })

  test("enables with explicit config opt-in and valid endpoint", () => {
    const config = resolveConfig({
      enabled: true,
      endpoint: "http://127.0.0.1:4318",
      headers: "api-key=test",
      channel: "preview",
    })
    expect(config.enabled).toBe(true)
    expect(config.endpoint).toBe("http://127.0.0.1:4318")
    expect(config.headers).toBe("api-key=test")
    expect(config.client).toBe("kilo-cli")
    expect(config.channel).toBe("preview")
  })

  test("enables with environment opt-in and endpoint", () => {
    const config = resolveConfig(
      {},
      {
        KILO_TELEMETRY_ENABLED: "1",
        KILO_TELEMETRY_ENDPOINT: "http://127.0.0.1:4318",
        KILO_TELEMETRY_HEADERS: "x-token=123",
        KILO_TELEMETRY_CLIENT: "kilo-test",
        KILO_TELEMETRY_CHANNEL: "test",
      },
    )
    expect(config.enabled).toBe(true)
    expect(config.endpoint).toBe("http://127.0.0.1:4318")
    expect(config.headers).toBe("x-token=123")
    expect(config.client).toBe("kilo-test")
    expect(config.channel).toBe("test")
  })

  test("rejects invalid or non-http endpoint URLs", () => {
    const invalidEndpoints = [
      "not-a-valid-url",
      "ftp://127.0.0.1:4318",
      "file:///var/log",
      "",
      "   ",
    ]
    for (const ep of invalidEndpoints) {
      const config = resolveConfig({ enabled: true, endpoint: ep }, {})
      expect(config.enabled).toBe(false)
      expect(config.endpoint).toBeUndefined()
    }
  })

  test("strips trailing slashes from endpoint", () => {
    const config = resolveConfig({
      enabled: true,
      endpoint: "http://127.0.0.1:4318///",
    })
    expect(config.endpoint).toBe("http://127.0.0.1:4318")
  })

  test("defines exactly four safe activity event types", () => {
    expect(SAFE_EVENT_TYPES).toEqual([
      "agent.updated",
      "catalog.updated",
      "command.updated",
      "config.updated",
    ])
  })

  test("defines lifecycle event types for host, session, and execution spans", () => {
    expect(LIFECYCLE_EVENT_TYPES).toEqual([
      "server.connected",
      "session.created",
      "session.deleted",
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted",
    ])
    expect(EXPORTABLE_EVENT_TYPES).toEqual([...SAFE_EVENT_TYPES, ...LIFECYCLE_EVENT_TYPES])
  })

  test("every exportable event name exists on the actual public server stream", () => {
    // server.connected is emitted at subscription time in
    // packages/server/src/handlers/event.ts and lives outside the manifest
    // inventory; everything else must be a real public server event type.
    for (const type of EXPORTABLE_EVENT_TYPES) {
      const actual = type === "server.connected" || EventManifest.isServer({ type })
      expect(actual).toBe(true)
    }
    // Content-bearing and high-frequency public events must stay outside the
    // exportable set.
    for (const type of [
      "session.text.delta",
      "session.reasoning.delta",
      "session.tool.called",
      "session.message.content.updated",
      "session.status",
      "session.idle",
      "permission.asked",
      "tui.prompt.append",
    ]) {
      expect(EXPORTABLE_EVENT_TYPES.some((exportable) => exportable === type)).toBe(false)
    }
  })
})

describe("safe activity exporter with local fake OTLP collector", () => {
  let server: Server
  let port: number
  let receivedBodies: string[]

  beforeEach(async () => {
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
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address()
        if (address && typeof address !== "string") port = address.port
        resolve()
      })
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test("exports only safe event types and strictly omits raw secrets, prompts, and data fields", async () => {
    const eventsToPublish: Array<{ type: string; data?: unknown }> = [
      {
        type: "prompt.created",
        data: {
          prompt: "super secret user prompt: please delete the database",
          token: "secret-token-abcdef123456",
        },
      },
      {
        type: "session.message",
        data: {
          text: "confidential assistant response",
          files: ["/etc/shadow", "/home/user/.ssh/id_rsa"],
        },
      },
      {
        type: "agent.updated",
        data: {
          internalSecret: "hunter2",
          promptTemplate: "internal system instructions",
        },
      },
      {
        type: "config.updated",
        data: {
          apiKey: "sk-live-api-key-999888777",
          password: "db-password",
        },
      },
      {
        type: "tool.execute",
        data: {
          command: "curl https://internal.corp/token",
        },
      },
    ]

    let resolveDone: () => void
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    const mockClient: EventSubscriberClient = {
      event: {
        async *subscribe({ signal } = {}) {
          for (const event of eventsToPublish) {
            if (signal?.aborted) return
            yield event
            await new Promise((r) => setTimeout(r, 10))
          }
          resolveDone()
        },
      },
    }

    const exporter = startActivityExporter(mockClient, {
      enabled: true,
      endpoint: `http://127.0.0.1:${port}`,
      client: "kilo-cli",
      version: "0.0.0-test",
      channel: "test-channel",
    })

    await donePromise
    await new Promise((r) => setTimeout(r, 100))
    await exporter.stop()

    expect(receivedBodies).toHaveLength(2)

    const combinedRawText = receivedBodies.join("\n")

    expect(combinedRawText).not.toContain("super secret user prompt")
    expect(combinedRawText).not.toContain("secret-token-abcdef123456")
    expect(combinedRawText).not.toContain("confidential assistant response")
    expect(combinedRawText).not.toContain("/etc/shadow")
    expect(combinedRawText).not.toContain("/home/user/.ssh/id_rsa")
    expect(combinedRawText).not.toContain("hunter2")
    expect(combinedRawText).not.toContain("internal system instructions")
    expect(combinedRawText).not.toContain("sk-live-api-key-999888777")
    expect(combinedRawText).not.toContain("db-password")
    expect(combinedRawText).not.toContain("curl https://internal.corp/token")

    expect(combinedRawText).toContain("agent.updated")
    expect(combinedRawText).toContain("config.updated")

    const parsed = JSON.parse(receivedBodies[0])
    const resourceAttrs = parsed.resourceLogs[0].resource.attributes
    expect(resourceAttrs.find((a: { key: string }) => a.key === "opencode.client")?.value?.stringValue).toBe("kilo-cli")
    expect(resourceAttrs.find((a: { key: string }) => a.key === "deployment.environment.name")?.value?.stringValue).toBe("test-channel")
    expect(resourceAttrs.find((a: { key: string }) => a.key === "service.name")?.value?.stringValue).toBe("kilo-cli")

    const logRecord = parsed.resourceLogs[0].scopeLogs[0].logRecords[0]
    expect(logRecord.body.stringValue).toBe("agent.updated")
    expect(logRecord.attributes).toEqual([{ key: "event.type", value: { stringValue: "agent.updated" } }])
  })

  test("exports lifecycle event names only and omits their payloads and content-bearing events", async () => {
    const eventsToPublish: Array<{ type: string; data?: unknown }> = [
      {
        type: "server.connected",
        data: { password: "host-basic-password-7788" },
      },
      {
        type: "session.created",
        data: {
          info: {
            title: "private session title: refactor billing",
            directory: "/home/user/private-project",
            secret: "session-created-secret-3344",
          },
        },
      },
      {
        type: "session.execution.started",
        data: { sessionID: "ses-private-9911", modelID: "internal-model" },
      },
      {
        type: "session.execution.failed",
        data: { error: "internal stack trace with token sk-live-556677" },
      },
      {
        type: "session.text.delta",
        data: { delta: "streamed assistant text must never be exported" },
      },
      {
        type: "permission.asked",
        data: { action: { title: "run rm -rf /" } },
      },
      {
        type: "session.status",
        data: { sessionID: "ses-status-2211", status: { type: "busy" } },
      },
    ]

    let resolveDone: () => void
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    const mockClient: EventSubscriberClient = {
      event: {
        async *subscribe({ signal } = {}) {
          for (const event of eventsToPublish) {
            if (signal?.aborted) return
            yield event
            await new Promise((r) => setTimeout(r, 10))
          }
          resolveDone()
        },
      },
    }

    const exporter = startActivityExporter(mockClient, {
      enabled: true,
      endpoint: `http://127.0.0.1:${port}`,
      client: "kilo-cli",
      version: "0.0.0-test",
      channel: "test-channel",
    })

    await donePromise
    await new Promise((r) => setTimeout(r, 100))
    await exporter.stop()

    expect(receivedBodies).toHaveLength(4)

    const combinedRawText = receivedBodies.join("\n")
    expect(combinedRawText).not.toContain("host-basic-password-7788")
    expect(combinedRawText).not.toContain("private session title")
    expect(combinedRawText).not.toContain("/home/user/private-project")
    expect(combinedRawText).not.toContain("session-created-secret-3344")
    expect(combinedRawText).not.toContain("ses-private-9911")
    expect(combinedRawText).not.toContain("internal-model")
    expect(combinedRawText).not.toContain("internal stack trace")
    expect(combinedRawText).not.toContain("sk-live-556677")
    expect(combinedRawText).not.toContain("streamed assistant text")
    expect(combinedRawText).not.toContain("rm -rf /")
    expect(combinedRawText).not.toContain("ses-status-2211")

    const exportedTypes = receivedBodies.map((body) => JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue)
    expect(exportedTypes).toEqual([
      "server.connected",
      "session.created",
      "session.execution.started",
      "session.execution.failed",
    ])
    for (const type of exportedTypes) {
      expect(EXPORTABLE_EVENT_TYPES.some((exportable) => exportable === type)).toBe(true)
    }
  })

  test("sends zero requests to collector when telemetry is disabled", async () => {
    const mockClient: EventSubscriberClient = {
      event: {
        async *subscribe() {
          yield { type: "agent.updated" }
          yield { type: "config.updated" }
        },
      },
    }

    const exporter = startActivityExporter(mockClient, {
      enabled: false,
      endpoint: `http://127.0.0.1:${port}`,
    })

    await new Promise((r) => setTimeout(r, 50))
    await exporter.stop()

    expect(receivedBodies).toHaveLength(0)
  })

  test("runs with Effect exportActivity and shuts down cleanly within Scope without hanging", async () => {
    let loopStarted = false
    const mockClient: EventSubscriberClient = {
      event: {
        async *subscribe({ signal } = {}) {
          loopStarted = true
          while (!signal?.aborted) {
            yield { type: "config.updated" }
            await new Promise((r) => setTimeout(r, 20))
          }
        },
      },
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* exportActivity(mockClient, {
            enabled: true,
            endpoint: `http://127.0.0.1:${port}`,
          })
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)))
        }),
      ),
    )

    expect(loopStarted).toBe(true)
    expect(receivedBodies.length).toBeGreaterThan(0)
  })

  test("resilient against offline collector without crashing", async () => {
    const mockClient: EventSubscriberClient = {
      event: {
        async *subscribe() {
          yield { type: "agent.updated" }
        },
      },
    }

    const exporter = startActivityExporter(mockClient, {
      enabled: true,
      endpoint: "http://127.0.0.1:59999",
    })

    await new Promise((r) => setTimeout(r, 50))
    await expect(exporter.stop()).resolves.toBeUndefined()
  })

  test("proves real OpenCode promise client satisfies EventSubscriberClient with interactive-fixture", async () => {
    // The interactive host requires the bundled Bun 1.4 runtime.
    const bundledBun = path.resolve(import.meta.dir, "../dist/interactive/bun")
    if (!(await Bun.file(bundledBun).exists())) {
      console.warn(`Skipping live-host telemetry proof: bundled runtime missing at ${bundledBun}`)
      return
    }
    await using input = await fixture()
    const child = Bun.spawn(
      [bundledBun, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")],
      {
        cwd: input.cwd,
        env: input.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20000,
      },
    )

    try {
      const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
      const password = (
        await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
      ).trim()

      const client = OpenCode.make({
        baseUrl: endpoint.value,
        headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
      })

      const exporter = startActivityExporter(client, {
        enabled: true,
        endpoint: `http://127.0.0.1:${port}`,
        client: "kilo-cli",
        version: "0.0.0-test",
        channel: "host-test",
      })

      // Trigger safe activity events by awaiting plugin activation on the project directory
      await client.plugin.awaitActivation({ location: { directory: input.cwd } })

      // Allow exported events to land at the local fake collector
      await new Promise((r) => setTimeout(r, 300))
      await exporter.stop()

      // The live host emits server.connected on subscribe, integration.updated,
      // agent.updated, command.updated, skill.updated, catalog.updated, etc.
      // Exporter must have processed events and exported ONLY exportable names,
      // including the host lifecycle marker.
      expect(receivedBodies.length).toBeGreaterThan(0)
      const allText = receivedBodies.join("\n")

      const exportedTypes = receivedBodies.map(
        (body) => JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue,
      )
      for (const type of exportedTypes) {
        expect(EXPORTABLE_EVENT_TYPES.some((exportable) => exportable === type)).toBe(true)
      }
      expect(exportedTypes).toContain("server.connected")

      // Confirms non-exportable events were filtered out
      expect(allText).not.toContain("skill.updated")
      expect(allText).not.toContain("websearch.updated")
      expect(allText).not.toContain("integration.updated")
    } finally {
      child.kill()
      await child.exited
    }
  })
})
