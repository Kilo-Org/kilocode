import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtempSync } from "node:fs"
import { arch, platform, release, tmpdir } from "node:os"
import path from "node:path"
import { Identity } from "../src/identity"
import { TelemetryEvent } from "../src/events"
import { Telemetry } from "../src/telemetry"
import { posthog } from "./posthog"

const root = path.resolve(import.meta.dir, "../../..")

async function start(host: string, enabled = true) {
  await Telemetry.init({ dataPath: mkdtempSync(path.join(tmpdir(), "kilo-telemetry-")), version: "1.0.0", enabled, host })
}

afterEach(async () => {
  await Telemetry.shutdown(2000)
  Identity.reset()
})

describe("Telemetry", () => {
  test("includes host OS and app properties, the organization and the machine identity", async () => {
    using backend = posthog()
    const previous = process.env.KILO_MACHINE_ID
    process.env.KILO_MACHINE_ID = "machine-a"
    await start(backend.url)
    if (previous === undefined) delete process.env.KILO_MACHINE_ID
    else process.env.KILO_MACHINE_ID = previous
    Identity.setOrganizationId("org-1")
    Telemetry.track(TelemetryEvent.CLI_START)
    await Telemetry.shutdown(2000)
    expect(backend.requests).toEqual(["/batch/"])
    expect(backend.batches).toHaveLength(1)
    expect(backend.batches[0]).toMatchObject({
      event: "CLI Start",
      distinct_id: "machine-a",
      properties: {
        appName: "kilo-cli",
        appVersion: "1.0.0",
        os_name: platform(),
        os_version: release(),
        os_arch: arch(),
        kilocodeOrganizationId: "org-1",
      },
    })
    // Signed out, so no person properties.
    expect(backend.batches[0]!.properties.$set).toBeUndefined()
  })

  test("event properties override the engine properties", async () => {
    using backend = posthog()
    await start(backend.url)
    Telemetry.track("Autocomplete Accept Suggestion", { appName: "kilo-code", platform: "vscode", suggestionLength: 3 })
    await Telemetry.shutdown(2000)
    expect(backend.batches[0]!.properties).toMatchObject({ appName: "kilo-code", platform: "vscode", suggestionLength: 3 })
  })

  test("every event is marked as v2, and a caller cannot change the mark", async () => {
    using backend = posthog()
    await start(backend.url)
    Telemetry.trackCliStart()
    Telemetry.track("Task Created", { kiloLine: "v1" })
    await Telemetry.shutdown(2000)
    expect(backend.batches.map((item) => item.properties.kiloLine)).toEqual(["v2", "v2"])
  })

  test("trackToolUsed sends Tool Used event with tool name and sessionId", async () => {
    using backend = posthog()
    await start(backend.url)
    Telemetry.trackToolUsed("chart", "session-123")
    await Telemetry.shutdown(2000)
    expect(backend.batches[0]).toMatchObject({
      event: TelemetryEvent.TOOL_USED,
      properties: { tool: "chart", sessionId: "session-123" },
    })
  })

  test("a disabled engine sends nothing and skips identity updates", async () => {
    using backend = posthog()
    await start(backend.url, false)
    expect(Telemetry.isEnabled()).toBe(false)
    await Telemetry.updateIdentity("token", undefined, backend.url)
    Telemetry.track(TelemetryEvent.CLI_START)
    Telemetry.trackError("boom")
    await Telemetry.shutdown(2000)
    expect(backend.requests).toEqual([])
  })

  test("an account switch aliases the machine to the new email, never the previous email", async () => {
    using backend = posthog()
    const api = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        Response.json({ user: { email: `${request.headers.get("authorization")?.replace("Bearer ", "")}@example.com` } }),
    })
    const previous = process.env.KILO_MACHINE_ID
    process.env.KILO_MACHINE_ID = "machine-b"
    try {
      await start(backend.url)
      await Telemetry.updateIdentity("first", undefined, api.url.origin)
      await Telemetry.updateIdentity("second", undefined, api.url.origin)
      await Telemetry.shutdown(2000)
      const aliases = backend.batches.filter((item) => item.event === "$create_alias")
      expect(aliases.map((item) => [item.distinct_id, item.properties.alias])).toEqual([
        ["first@example.com", "machine-b"],
        ["second@example.com", "machine-b"],
      ])
    } finally {
      api.stop(true)
      if (previous === undefined) delete process.env.KILO_MACHINE_ID
      else process.env.KILO_MACHINE_ID = previous
    }
  })

  test("setEnabled(false) drops the events captured after it", async () => {
    using backend = posthog()
    await start(backend.url)
    Telemetry.trackCommandUsed("first")
    // PostHog queues a capture asynchronously; a consent withdrawn in the same tick drops the event too.
    await Bun.sleep(20)
    Telemetry.setEnabled(false)
    Telemetry.trackCommandUsed("second")
    await Telemetry.shutdown(2000)
    expect(backend.batches.map((item) => item.properties.command)).toEqual(["first"])
  })
})

test("the engine event catalog is the v1 catalog", async () => {
  const features = (await Bun.file(path.join(root, "migration-tracking/progress/features.json")).json()) as {
    pins: { v1Target: string }
  }
  const pin = features.pins.v1Target
  // A shallow CI checkout has no v1 history: fetch the pinned commit without blobs, then read the one file.
  const present = async () => (await $`git cat-file -e ${pin}^{commit}`.cwd(root).quiet().nothrow()).exitCode === 0
  // Another test process can hold the git locks while it fetches the same commit; it then exists afterwards.
  if (!(await present())) await $`git fetch --no-tags --depth=1 --filter=blob:none origin ${pin}`.cwd(root).quiet().nothrow()
  for (let attempt = 0; attempt < 50 && !(await present()); attempt++) await Bun.sleep(200)
  if (!(await present())) throw new Error(`the v1 pin ${pin} is not in this checkout and could not be fetched from origin`)
  const source = await $`git show ${`${pin}:packages/kilo-telemetry/src/events.ts`}`.cwd(root).quiet().text()
  const v1 = [...source.matchAll(/^\s*([A-Z0-9_]+) = "([^"]*)",?$/gm)].map((match) => [match[1], match[2]])
  // A member the pattern cannot read must fail the test, not drop out of it.
  expect(v1).toHaveLength(source.split("\n").filter((line) => line.includes(" = ")).length)
  expect(v1.length).toBeGreaterThan(20)
  expect(Object.entries(TelemetryEvent).map(([key, value]) => [key, value as string])).toEqual(v1)
}, 60_000)
