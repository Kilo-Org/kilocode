import { afterEach, beforeEach, expect, test } from "bun:test"
import { createSessionTransport } from "../../src/mini/stream-v2.transport"
import { createFooterApiFixture } from "../mini/fixture/footer-api"
import { model, session } from "../fixture/local"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"

let previous: string | undefined
beforeEach(() => {
  previous = process.env.KILO_MODEL_STARTUP
  process.env.KILO_MODEL_STARTUP = "1"
})
afterEach(() => {
  if (previous === undefined) delete process.env.KILO_MODEL_STARTUP
  else process.env.KILO_MODEL_STARTUP = previous
})

test.each(["prompt", "queue", "command"] as const)(
  "mini %s waits for the effective target model before mutations",
  async (kind) => {
    await using setup = await fixture(kind === "command")
    const next = {
      agent: "build",
      model: kind === "command" ? { providerID: "other", modelID: "ready" } : { providerID: "kilo", modelID: "foo" },
      variant: "high",
      prompt: {
        text: "AFTER_CATALOG",
        parts: [],
        messageID: "msg_catalog",
        command: kind === "command" ? { name: "review", arguments: "AFTER_CATALOG" } : undefined,
      },
      files: [],
      includeFiles: false,
    }
    const sent = kind === "queue" ? setup.transport.admitPromptTurn(next, "queue") : setup.transport.runPromptTurn(next)
    await setup.started
    expect(setup.mutations).toEqual([])
    setup.populate()
    await sent
    expect(setup.locations.every((value) => value === directory)).toBe(true)
    expect(setup.mutations.filter((item) => item.type === (kind === "command" ? "command" : "prompt"))).toHaveLength(1)
    if (kind === "command") {
      expect(setup.mutations.map((item) => item.type)).toEqual(["command"])
      return
    }
    expect(setup.mutations.map((item) => item.type)).toEqual(["agent", "model", "prompt"])
    expect(setup.mutations[1]?.body).toEqual({ model: { providerID: "kilo", id: "foo", variant: "high" } })
  },
)

test.each(["abort", "close"] as const)("mini catalog wait cannot submit after %s", async (cancel) => {
  await using setup = await fixture()
  const controller = new AbortController()
  const sent = setup.transport.runPromptTurn({
    agent: "build",
    model: { providerID: "kilo", modelID: "foo" },
    variant: undefined,
    prompt: { text: "CANCELLED", parts: [], messageID: "msg_cancelled" },
    files: [],
    includeFiles: false,
    signal: controller.signal,
  })
  const rejected = sent.then(
    () => undefined,
    (error: unknown) => error,
  )
  await setup.started
  if (cancel === "abort") controller.abort()
  else await setup.transport.close()
  expect(await rejected).toBeInstanceOf(Error)
  setup.populate()
  expect(setup.mutations).toEqual([])
})

test("mini with a ready non-Kilo model does not wait for the Gateway", async () => {
  await using setup = await fixture(true)
  await setup.transport.admitPromptTurn(
    {
      agent: undefined,
      model: { providerID: "other", modelID: "ready" },
      variant: undefined,
      prompt: { text: "READY", parts: [], messageID: "msg_ready" },
      files: [],
      includeFiles: false,
    },
    "steer",
  )
  expect(setup.catalogStatusReads()).toBe(0)
  expect(setup.mutations.map((item) => item.type)).toEqual(["model", "prompt"])
})

test("mini interrupt cancels a catalog wait before it can send", async () => {
  await using setup = await fixture()
  const sent = setup.transport.runPromptTurn({
    agent: "build",
    model: { providerID: "kilo", modelID: "foo" },
    variant: undefined,
    prompt: { text: "INTERRUPTED", parts: [], messageID: "msg_interrupted" },
    files: [],
    includeFiles: false,
  })
  await setup.started
  await setup.transport.interruptActiveTurn()
  await sent
  setup.populate()
  expect(setup.mutations).toEqual([{ type: "interrupt", body: { resume: true } }])
})

async function fixture(otherReady = false) {
  const saved = session("ses_catalog", { providerID: "kilo", id: "foo" })
  const selected = { ...model("foo", ["high"]), providerID: "kilo" }
  const other = { ...model("ready"), providerID: "other" }
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const events = createEventStream()
  const mutations: { type: string; body: unknown }[] = []
  const locations: string[] = []
  const started = Promise.withResolvers<void>()
  let populated = false
  let catalogStatusReads = 0
  const calls = createFetch(async (url, request) => {
    if (url.pathname === `/api/session/${saved.id}`) return json({ data: saved })
    if (/^\/api\/session\/[^/]+\/(message|inbox)$/.test(url.pathname)) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/experimental/session/${saved.id}/wait`) return new Response(null, { status: 204 })
    if (url.pathname === "/api/model") {
      locations.push(url.searchParams.get("location.directory") ?? url.searchParams.get("location[directory]") ?? "")
      started.resolve()
      return json({ location, data: [...(otherReady ? [other] : []), ...(populated ? [selected] : [])] })
    }
    if (url.pathname === "/api/rpc/kilocode.gateway/catalog.status") {
      catalogStatusReads++
      return json({ output: { failure: null } })
    }
    if (url.pathname === "/api/command")
      return json({ location, data: [{ name: "review", model: { providerID: "kilo", model: "foo" } }] })
    const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|prompt|command|interrupt)$/)?.[1]
    if (!type || request.method !== "POST") return
    const body = type === "interrupt" ? { resume: url.searchParams.get("resume") === "true" } : await request.json()
    mutations.push({ type, body })
    if (type === "prompt")
      return json({
        data: {
          id: body.id,
          sessionID: saved.id,
          type: "user",
          payload: body,
          delivery: body.delivery,
          time: { created: 1 },
        },
      })
    return new Response(null, { status: 204 })
  }, events)
  const footer = createFooterApiFixture()
  const transport = await createSessionTransport({
    sdk: createApi(calls.fetch),
    sessionID: saved.id,
    location,
    thinking: false,
    footer: footer.api,
  })
  return {
    transport,
    mutations,
    locations,
    started: started.promise,
    catalogStatusReads: () => catalogStatusReads,
    populate: () => {
      populated = true
    },
    async [Symbol.asyncDispose]() {
      await transport.close()
      footer.api.destroy()
    },
  }
}
