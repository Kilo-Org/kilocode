import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "kilo-delivery-"))
  await Bun.write(path.join(dir, "telemetry-id"), "test-machine")
  await Bun.write(
    path.join(dir, "telemetry-profile.json"),
    JSON.stringify({
      token: createHash("sha256").update("test-token").digest("hex"),
      email: "test@example.com",
      fetchedAt: Date.now(),
    }),
  )
})
afterEach(() => rm(dir, { recursive: true, force: true }))

async function run(env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/identity-process.ts")], {
    env: {
      ...process.env,
      KILO_TELEMETRY_LEVEL: "all",
      KILO_APP_NAME: "kilo-cli",
      KILO_APP_VERSION: "",
      KILO_MACHINE_ID: "",
      TEST_DATA: dir,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  const result: {
    event: string
    distinct_id: string
    properties: { alias?: string; $set?: Record<string, unknown> }
  }[] = JSON.parse(output)
  expect(result.filter((event) => event.event === "$identify")).toEqual([])
  return result
}

test("startup sends one alias and preserves identity across restarts", async () => {
  const first = await run()
  expect(first.filter((event) => event.event === "$create_alias")).toHaveLength(1)
  expect(first.find((event) => event.event === "$create_alias")?.properties.alias).toBe("test-machine")
  const next = await run({ TEST_VERSION: "2.0.0", TEST_ORG: "org-new" })
  expect(next).toHaveLength(1)
  expect(next.at(0)).toMatchObject({
    event: "CLI Start",
    distinct_id: "test@example.com",
    properties: { $set: { appName: "kilo-cli", appVersion: "2.0.0", kilocodeOrganizationId: "org-new" } },
  })
})

test("failed uploads do not suppress identity events on the next process", async () => {
  await run({ TEST_FAIL: "1" })
  const next = await run()
  expect(next.filter((event) => event.event === "$create_alias")).toHaveLength(1)
}, 20000)

test("a new machine gets its own alias even when the user properties are unchanged", async () => {
  await run()
  const events = await run({ KILO_MACHINE_ID: "second-machine" })
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
  expect(events.find((event) => event.event === "$create_alias")?.properties.alias).toBe("second-machine")
  expect(events.every((event) => event.distinct_id === "test@example.com")).toBe(true)
})

test("login updates person properties on Auth Success without adding an identify event", async () => {
  const events = await run({ TEST_LOGIN: "1", TEST_ORG: "org-login" })
  const start = events.find((event) => event.event === "CLI Start")
  expect(start?.distinct_id).toBe("test-machine")
  expect(start?.properties.$set).toBeUndefined()
  const auth = events.find((event) => event.event === "Auth Success")
  expect(auth?.distinct_id).toBe("test@example.com")
  expect(auth?.properties.$set).toMatchObject({ appVersion: "1.0.0", kilocodeOrganizationId: "org-login" })
  const exit = events.find((event) => event.event === "CLI Exit")
  expect(exit?.distinct_id).toBe("test@example.com")
  expect(exit?.properties.$set).toBeUndefined()
})
