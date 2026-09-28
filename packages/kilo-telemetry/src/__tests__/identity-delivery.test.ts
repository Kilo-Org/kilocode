import { afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
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

test("process restarts keep activity identified without resending confirmed identity events", async () => {
  const first = await run()
  expect(first.filter((event) => event.event === "$create_alias")).toHaveLength(1)
  expect(first.find((event) => event.event === "$create_alias")?.properties.alias).toBe("test-machine")
  const next = await run()
  expect(next.filter((event) => event.event === "$identify" || event.event === "$create_alias")).toEqual([])
  expect(next).toHaveLength(1)
  expect(next.at(0)?.distinct_id).toBe("test@example.com")
  expect(next.at(0)?.properties.$set).toMatchObject({ appName: "kilo-cli", appVersion: "1.0.0" })
})

test("changed properties update the person without repeating the machine alias", async () => {
  await run()
  const next = await run({ TEST_VERSION: "2.0.0", TEST_ORG: "org-new" })
  expect(next.find((event) => event.event === "CLI Start")?.properties.$set).toMatchObject({
    appVersion: "2.0.0",
    kilocodeOrganizationId: "org-new",
  })
  expect(next.filter((event) => event.event === "$create_alias")).toEqual([])
})

test("failed uploads do not suppress identity events on the next process", async () => {
  await run({ TEST_FAIL: "1" })
  const next = await run()
  expect(next.filter((event) => event.event === "$create_alias")).toHaveLength(1)
}, 20000)

test("concurrent auth initialization queues each identity event once", async () => {
  const events = await run({ TEST_CONCURRENT: "1" })
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
})

test("logout activity uses the machine ID and later login still identifies activity", async () => {
  await run()
  const logout = await run({ TEST_LOGOUT: "1" })
  expect(logout).toHaveLength(1)
  expect(logout.at(0)?.distinct_id).toBe("test-machine")
  expect(logout.at(0)?.properties.$set).toBeUndefined()
  const login = await run()
  expect(login).toHaveLength(1)
  expect(login.at(0)?.distinct_id).toBe("test@example.com")
})

test("a new machine gets its own alias even when the user properties are unchanged", async () => {
  await run()
  const events = await run({ KILO_MACHINE_ID: "second-machine" })
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
  expect(events.find((event) => event.event === "$create_alias")?.properties.alias).toBe("second-machine")
  expect(events.every((event) => event.distinct_id === "test@example.com")).toBe(true)
})

test("a different user is identified independently", async () => {
  await run()
  const file = Bun.file(path.join(dir, "telemetry-profile.json"))
  const profile = await file.json()
  await Bun.write(file, JSON.stringify({ ...profile, email: "second@example.com" }))
  const events = await run()
  expect(events.every((event) => event.distinct_id === "second@example.com")).toBe(true)
})

test("corrupt delivery caches fail open and contain no raw identity data", async () => {
  await run()
  const files = (await readdir(dir)).filter((name) => name.startsWith("telemetry-alias-"))
  expect(files).toHaveLength(1)
  for (const file of files) {
    expect(file).toMatch(/^telemetry-alias-[a-f0-9]{64}$/)
    expect(await Bun.file(path.join(dir, file)).text()).toBe("1")
    await Bun.write(path.join(dir, file), "corrupt")
  }
  const events = await run()
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
})

test("disabled telemetry sends nothing and does not mark identity events as delivered", async () => {
  expect(await run({ KILO_TELEMETRY_LEVEL: "off" })).toEqual([])
  const events = await run()
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
})

test("returning to earlier properties sends the latest values again", async () => {
  await run()
  await run({ TEST_VERSION: "2.0.0" })
  const events = await run()
  expect(events.find((event) => event.event === "CLI Start")?.properties.$set?.appVersion).toBe("1.0.0")
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
