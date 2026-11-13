import { afterAll, afterEach, beforeEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Message } from "./posthog"

// Each run is a fresh engine process against a local PostHog stand-in, so the alias markers and the profile cache
// carry over between runs only through the data directory, as between two real processes.
const state = { dir: "", fail: false, batches: [] as Message[] }
const posthog = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { batch?: Message[] }
    if (state.fail) return Response.json({}, { status: 400 })
    state.batches.push(...(body.batch ?? []))
    return Response.json({ status: 1 })
  },
})

beforeEach(async () => {
  state.dir = await mkdtemp(path.join(tmpdir(), "kilo-delivery-"))
  state.fail = false
  await Bun.write(path.join(state.dir, "telemetry-id"), "test-machine")
  await Bun.write(
    path.join(state.dir, "telemetry-profile.json"),
    JSON.stringify({
      token: createHash("sha256").update("test-token").digest("hex"),
      email: "test@example.com",
      fetchedAt: Date.now(),
    }),
  )
})
afterEach(() => rm(state.dir, { recursive: true, force: true }))
afterAll(() => posthog.stop(true))

async function run(env: Record<string, string> = {}) {
  state.batches = []
  state.fail = env.TEST_FAIL === "1"
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/identity-process.ts")], {
    env: {
      ...process.env,
      KILO_APP_NAME: "kilo-cli",
      KILO_APP_VERSION: "",
      KILO_MACHINE_ID: "",
      TEST_DATA: state.dir,
      TEST_POSTHOG: posthog.url.origin,
      // The profile cache answers the token, so the profile endpoint is never asked.
      TEST_API: "http://127.0.0.1:9",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
  expect(state.batches.filter((event) => event.event === "$identify")).toEqual([])
  return state.batches
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

test("disabled telemetry writes no alias marker and a later enabled run sends the alias", async () => {
  expect(await run({ TEST_ENABLED: "0" })).toEqual([])
  expect((await readdir(state.dir)).filter((file) => file.startsWith("telemetry-alias-"))).toEqual([])
  const events = await run()
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
})

test.each(["corrupt", "unreadable"])("an alias marker that is %s does not suppress the alias", async (kind) => {
  await run()
  const name = (await readdir(state.dir)).find((file) => file.startsWith("telemetry-alias-"))
  expect(name).toBeDefined()
  const file = path.join(state.dir, name!)
  await rm(file)
  if (kind === "corrupt") await Bun.write(file, "invalid")
  if (kind === "unreadable") await mkdir(file)
  const events = await run()
  expect(events.filter((event) => event.event === "$create_alias")).toHaveLength(1)
})

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
