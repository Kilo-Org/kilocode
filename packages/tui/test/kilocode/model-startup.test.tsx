import { afterEach, beforeEach, expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "../fixture/app"
import { agent, model, renderLocal, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

let previous: string | undefined
beforeEach(() => {
  previous = process.env.KILO_MODEL_STARTUP
  process.env.KILO_MODEL_STARTUP = "1"
})
afterEach(() => {
  if (previous === undefined) delete process.env.KILO_MODEL_STARTUP
  else process.env.KILO_MODEL_STARTUP = previous
})

test.each(["cli", "config", "agent"] as const)(
  "a pending %s model is not replaced by a ready provider",
  async (preference) => {
    const selected = { ...model("foo"), providerID: "kilo" }
    const other = model("ready")
    let populated = false
    await using setup = await renderLocal({
      args: { model: preference === "cli" ? "kilo/foo" : undefined },
      agents: [agent("build", preference === "agent" ? { providerID: "kilo", id: "foo" } : undefined)],
      waitForDefault: false,
      fetch: (url) => {
        if (url.pathname === "/api/config" && preference === "config")
          return json([{ type: "document", info: { model: "kilo/foo" } }])
        if (url.pathname === "/api/model")
          return json({ location: { directory }, data: [other, ...(populated ? [selected] : [])] })
        if (url.pathname === "/api/model/default") return json({ location: { directory }, data: other })
        if (url.pathname === "/api/rpc/kilocode.gateway/catalog.status") return json({ output: { failure: null } })
      },
    })
    expect(setup.local.model.current()).toEqual({ providerID: "kilo", modelID: "foo" })
    expect(setup.local.model.catalogReady).toBe(false)
    populated = true
    setup.events.emit({ id: "evt_populated", type: "model.updated", created: 1, location: { directory }, data: {} })
    await until(() => setup.local.model.catalogReady)
    expect(setup.local.model.current()).toEqual({ providerID: "kilo", modelID: "foo" })
  },
)

test("a settled unavailable CLI model keeps the existing fallback", async () => {
  const other = model("ready")
  await using setup = await renderLocal({
    args: { model: "kilo/missing" },
    models: [other, { ...model("available"), providerID: "kilo" }],
    fetch: (url) =>
      url.pathname === "/api/model/default" ? json({ location: { directory }, data: other }) : undefined,
  })
  expect(setup.local.model.current()).toEqual({ providerID: "provider", modelID: "ready" })
})

test("an initial prompt retains its saved model and submits once after an empty catalog fills", async () => {
  await using setup = await fixture("START_AFTER_CATALOG")
  await setup.ready
  await setup.loaded
  const cold = await setup.waitForFrame((frame) => frame.includes("START_AFTER_CATALOG"))
  expect(cold).toContain("START_AFTER_CATALOG")
  expect(cold).not.toContain("Model unavailable")
  expect(setup.mutations).toEqual([])

  setup.populate()
  await until(() => setup.mutations.some((mutation) => mutation.type === "prompt"))
  expect(setup.mutations).toEqual([
    { type: "model", body: { model: { providerID: "kilo", id: "foo", variant: "high" } } },
    {
      type: "prompt",
      body: expect.objectContaining({ text: "START_AFTER_CATALOG" }),
    },
  ])
  setup.populate()
  await setup.waitForFrame((frame) => frame.includes("Build") && !frame.includes("foo (unavailable)"))
  expect(setup.mutations.filter((mutation) => mutation.type === "prompt")).toHaveLength(1)
})

test("early Enter preserves the draft without warning or automatically submitting it later", async () => {
  await using setup = await fixture()
  await setup.ready
  await setup.loaded
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("Keep my draft")
  setup.mockInput.pressEnter()
  const cold = await setup.waitForFrame((frame) => frame.includes("Keep my draft"))
  expect(cold).not.toContain("Model unavailable")
  expect(cold).not.toContain("Connect an integration")
  expect(setup.mutations).toEqual([])

  setup.populate()
  await setup.waitForFrame((frame) => frame.includes("Build") && !frame.includes("foo (unavailable)"))
  expect(setup.mutations).toEqual([])
  setup.mockInput.pressEnter()
  await until(() => setup.mutations.some((mutation) => mutation.type === "prompt"))
  expect(setup.mutations.filter((mutation) => mutation.type === "prompt")).toEqual([
    { type: "prompt", body: expect.objectContaining({ text: "Keep my draft" }) },
  ])
})

test("an existing-session shell command does not wait for a model catalog", async () => {
  await using setup = await fixture()
  await setup.ready
  await setup.loaded
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  await setup.mockInput.typeText("!")
  await setup.mockInput.typeText("pwd")
  setup.mockInput.pressEnter()
  await until(() => setup.mutations.length > 0)
  expect(setup.mutations).toEqual([{ type: "shell", body: { command: "pwd" } }])
})

test("a command's own model waits independently of the ready composer model", async () => {
  await using setup = await fixture(undefined, { otherReady: true })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("ready"))
  await setup.mockInput.typeText("/review AFTER_CATALOG")
  setup.mockInput.pressEscape()
  const reads = setup.catalogReads()
  setup.mockInput.pressEnter()
  await until(() => setup.catalogReads() > reads)
  expect(setup.mutations).toEqual([])
  setup.populate()
  await until(() => setup.mutations.some((mutation) => mutation.type === "command"))
  expect(setup.mutations.map((mutation) => mutation.type)).toEqual(["model", "command"])
  expect(setup.mutations[0]?.body).toEqual({ model: { providerID: "other", id: "ready" } })
})

test.each([false, true])("compact waits for the selected model and can be cancelled (cancel: %s)", async (cancel) => {
  await using setup = await fixture()
  await setup.ready
  await setup.loaded
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const reads = setup.catalogReads()
  setup.mockInput.pressKey("F6")
  await until(() => setup.catalogReads() > reads)
  expect(setup.mutations).toEqual([])
  if (cancel) {
    setup.mockInput.pressEscape()
    await setup.renderOnce()
  }
  setup.populate()
  if (!cancel) {
    await until(() => setup.mutations.some((mutation) => mutation.type === "compact"))
    expect(setup.mutations.map((mutation) => mutation.type)).toEqual(["model", "compact"])
    return
  }
  await setup.waitForFrame((frame) => frame.includes("Build") && !frame.includes("unavailable"))
  expect(setup.mutations).toEqual([])
})

test("a new worktree waits for its own catalog rather than using the ready source catalog", async () => {
  await using setup = await fixture(undefined, { worktree: true })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("foo"))
  setup.mockInput.pressKey("F8")
  await setup.waitForFrame(
    (frame) => frame.includes("Worktrees") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  setup.mockInput.pressKey("a", { ctrl: true })
  await setup.waitForFrame(
    (frame) => frame.includes("Name worktree") && setup.renderer.currentFocusedEditor instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("cold-target")
  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) =>
      frame.includes("(new worktree)") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  await setup.mockInput.typeText("DESTINATION_READY")
  setup.mockInput.pressEnter()
  await setup.destinationRead
  expect(setup.mutations).toEqual([])
  setup.populate()
  await until(() => setup.mutations.some((mutation) => mutation.type === "prompt"))
  expect(setup.mutations[0]).toEqual({
    type: "create",
    body: expect.objectContaining({
      location: { directory: `${directory}/created` },
      model: { providerID: "kilo", id: "foo" },
    }),
  })
  expect(setup.mutations.filter((mutation) => mutation.type === "prompt")).toHaveLength(1)
})

async function fixture(prompt?: string, options: { otherReady?: boolean; worktree?: boolean } = {}) {
  let saved = session(
    `ses_${crypto.randomUUID()}`,
    options.otherReady ? { providerID: "other", id: "ready" } : { providerID: "kilo", id: "foo", variant: "high" },
  )
  const selected = { ...model("foo", ["high"]), providerID: "kilo" }
  const other = { ...model("ready"), providerID: "other" }
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const mutations: { type: string; body: unknown }[] = []
  const loaded = Promise.withResolvers<void>()
  const destinationRead = Promise.withResolvers<void>()
  let populated = false
  let catalogReads = 0
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: options.worktree ? undefined : saved.id, prompt },
    config: { animations: false, tabs: { mode: "off" }, keybinds: { "session.compact": "f6", "session.move": "f8" } },
    fetch: async (url, request) => {
      const target =
        url.searchParams.get("location[directory]") ?? url.searchParams.get("location.directory") ?? directory
      if (url.pathname === "/api/location") return json({ ...location, directory: target })
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build")] })
      if (url.pathname === "/api/model") {
        catalogReads++
        if (target === `${directory}/created`) destinationRead.resolve()
        return json({
          location: { ...location, directory: target },
          data: [
            ...(options.otherReady ? [other] : []),
            ...(populated || (options.worktree && target !== `${directory}/created`) ? [selected] : []),
          ],
        })
      }
      if (url.pathname === "/api/model/default") {
        loaded.resolve()
        return json({
          location,
          data: populated || options.worktree ? selected : options.otherReady ? other : undefined,
        })
      }
      if (url.pathname === "/api/provider")
        return json({
          location,
          data: [
            { id: "kilo", name: "Kilo" },
            { id: "other", name: "Other" },
          ],
        })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", model: { providerID: "kilo", model: "foo" } }] })
      if (url.pathname === "/api/rpc/kilocode.gateway/catalog.status") return json({ output: { failure: null } })
      if (url.pathname === "/api/worktree")
        return request.method === "POST" ? json({ directory: `${directory}/created` }) : json([{ directory }])
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body = await request.json()
        mutations.push({ type: "create", body })
        saved = { ...saved, ...body }
        return json({ data: saved })
      }
      if (url.pathname === "/api/session") return json({ data: options.worktree ? [] : [saved], cursor: {} })
      if (url.pathname === `/api/session/${saved.id}`) return json({ data: saved })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|prompt|command|compact|shell)$/)?.[1]
      if (!type || request.method !== "POST") return
      const body = await request.json()
      mutations.push({ type, body })
      if (type === "prompt")
        return json({
          data: {
            id: body.id,
            sessionID: saved.id,
            type: "user",
            payload: body,
            delivery: "steer",
            time: { created: 1 },
          },
        })
      if (type === "compact")
        return json({
          data: {
            id: body.id,
            sessionID: saved.id,
            type: "compaction",
            payload: { reason: "manual" },
            delivery: "steer",
            time: { created: 1 },
          },
        })
      return new Response(null, { status: 204 })
    },
  })
  return {
    ...setup,
    loaded: loaded.promise,
    destinationRead: destinationRead.promise,
    catalogReads: () => catalogReads,
    mutations,
    populate() {
      populated = true
      setup.events.emit({ id: `evt_${crypto.randomUUID()}`, created: 1, type: "model.updated", location, data: {} })
    },
  }
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for TUI admission")
    await Bun.sleep(10)
  }
}
