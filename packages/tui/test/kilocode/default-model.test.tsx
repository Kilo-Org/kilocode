import { expect, test } from "bun:test"
import { createComputed, createRoot } from "solid-js"
import { agent, model, renderLocal, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

const first = { ...model("first"), providerID: "kilo" }
const recommended = { ...model("vendor/recommended"), providerID: "kilo" }

test("full TUI uses the SDK recommendation instead of the first catalog model", async () => {
  const locations: string[] = []
  await using setup = await renderLocal({
    models: [first, recommended],
    fetch: (url) => {
      if (url.pathname !== "/api/model/default") return
      locations.push(url.searchParams.get("location[directory]")!)
      return json({ location: { directory }, data: recommended })
    },
  })
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()).toEqual({ providerID: "kilo", modelID: "vendor/recommended" })
  expect(locations.length).toBeGreaterThan(0)
  expect(locations.every((value) => value === directory)).toBe(true)
})

test.each(["cli", "config", "agent", "recent", "user", "session"] as const)(
  "%s selection takes precedence over the SDK recommendation",
  async (selection) => {
    await using setup = await renderLocal({
      models: [first, recommended, model("cli"), model("config"), model("agent"), model("recent"), model("user")],
      args: { model: selection !== "config" && selection !== "recent" ? "provider/cli" : undefined },
      agents: [
        agent(
          "build",
          ["agent", "user", "session"].includes(selection) ? { providerID: "provider", id: "agent" } : undefined,
        ),
      ],
      preferences: { recent: [{ providerID: "provider", modelID: "recent" }] },
      sessions: [session("ses_saved", { providerID: "provider", id: "user" })],
      fetch: (url) => {
        if (url.pathname === "/api/model/default") return json({ location: { directory }, data: recommended })
        if (url.pathname === "/api/config" && selection !== "recent")
          return json([{ type: "document", info: { model: "provider/config" } }])
      },
    })
    if (selection === "user") setup.local.model.set({ providerID: "provider", modelID: "user" })
    if (selection === "session") {
      await setup.data.session.sync("ses_saved")
      setup.route.navigate({ type: "session", sessionID: "ses_saved" })
    }
    await until(() => setup.local.model.catalogReady)
    expect(setup.local.model.current()).toEqual({
      providerID: "provider",
      modelID: selection === "session" ? "user" : selection,
    })
  },
)

test.each(["absent", "unavailable", "failed"] as const)(
  "keeps the upstream first-model fallback when the SDK default is %s",
  async (result) => {
    await using setup = await renderLocal({
      models: [first, recommended],
      args: { model: "kilo/missing-cli" },
      agents: [agent("build", { providerID: "kilo", id: "missing-agent" })],
      preferences: { recent: [{ providerID: "kilo", modelID: "missing-recent" }] },
      fetch: (url) => {
        if (url.pathname === "/api/config") return json([{ type: "document", info: { model: "kilo/missing-config" } }])
        if (url.pathname !== "/api/model/default") return
        if (result === "failed") return new Response(null, { status: 503 })
        return json({ location: { directory }, data: result === "absent" ? undefined : model("missing-default") })
      },
    })
    await until(() => setup.local.model.catalogReady)
    expect(setup.local.model.current()).toEqual({ providerID: "kilo", modelID: "first" })
  },
)

test("waits for the SDK default before allowing automatic prompt submission", async () => {
  const response = Promise.withResolvers<Response>()
  await using setup = await renderLocal({
    models: [first, recommended],
    args: { prompt: "test prompt" },
    waitForDefault: false,
    fetch: (url) => {
      if (url.pathname === "/api/model/default") return response.promise.then((value) => value.clone())
    },
  })
  expect(setup.local.model.catalogReady).toBe(false)
  expect(setup.local.model.current()).toBeUndefined()
  response.resolve(json({ location: { directory }, data: recommended }))
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()?.modelID).toBe(recommended.id)
})

test("a user selection made during default loading is not replaced by the response", async () => {
  const response = Promise.withResolvers<Response>()
  await using setup = await renderLocal({
    models: [first, recommended],
    waitForDefault: false,
    fetch: (url) => {
      if (url.pathname === "/api/model/default") return response.promise.then((value) => value.clone())
    },
  })
  setup.local.model.set({ providerID: "kilo", modelID: first.id })
  expect(setup.local.model.catalogReady).toBe(true)
  response.resolve(json({ location: { directory }, data: recommended }))
  await setup.renderOnce()
  expect(setup.local.model.current()?.modelID).toBe(first.id)
})

test("refreshes the recommendation with the catalog without replacing a user selection", async () => {
  let selected = recommended
  await using setup = await renderLocal({
    models: [first, recommended],
    fetch: (url) => {
      if (url.pathname === "/api/model/default") return json({ location: { directory }, data: selected })
    },
  })
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()?.modelID).toBe(recommended.id)
  selected = first
  setup.events.emit({ id: "evt_refresh", type: "model.updated", created: 1, location: { directory }, data: {} })
  await until(() => setup.local.model.current()?.modelID === first.id)
  setup.local.model.set({ providerID: "kilo", modelID: first.id })
  selected = recommended
  setup.data.location.model.invalidate()
  await setup.data.location.model.sync()
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()?.modelID).toBe(first.id)
})

test.each(["catalog", "config"] as const)(
  "retains the prompt model while a same-location %s refresh is pending",
  async (refresh) => {
    const response = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    let pending = false
    await using setup = await renderLocal({
      models: [first, recommended],
      fetch: (url) => {
        if (url.pathname !== "/api/model/default") return
        if (!pending) return json({ location: { directory }, data: recommended })
        started.resolve()
        return response.promise.then((value) => value.clone())
      },
    })
    const selection = { providerID: "kilo", modelID: recommended.id, variant: undefined }
    expect(setup.local.model.selection()).toEqual(selection)
    const observed = [{ selection: setup.local.model.selection(), ready: setup.local.model.catalogReady }]
    const dispose = createRoot((dispose) => {
      createComputed(() => {
        observed.push({ selection: setup.local.model.selection(), ready: setup.local.model.catalogReady })
      })
      return dispose
    })
    try {
      pending = true
      const resource = refresh === "catalog" ? setup.data.location.model : setup.data.location.config
      resource.invalidate()
      await resource.sync()
      await started.promise
      expect(setup.local.model.selection()).toEqual(selection)
      expect(setup.local.model.catalogReady).toBe(true)
      expect(observed.every((value) => value.ready && value.selection?.modelID === recommended.id)).toBe(true)
      response.resolve(json({ location: { directory }, data: first }))
      await until(() => setup.local.model.current()?.modelID === first.id)
    } finally {
      dispose()
      response.resolve(json({ location: { directory }, data: first }))
    }
  },
)

test("drops a retained recommendation removed from the visible catalog before applying the fallback", async () => {
  const response = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  let pending = false
  await using setup = await renderLocal({
    fetch: (url) => {
      if (url.pathname === "/api/model")
        return json({ location: { directory }, data: pending ? [first] : [first, recommended] })
      if (url.pathname !== "/api/model/default") return
      if (!pending) return json({ location: { directory }, data: recommended })
      started.resolve()
      return response.promise.then((value) => value.clone())
    },
  })
  expect(setup.local.model.current()?.modelID).toBe(recommended.id)
  pending = true
  setup.data.location.model.invalidate()
  await setup.data.location.model.sync()
  await started.promise
  expect(setup.local.model.selection()).toBeUndefined()
  expect(setup.local.model.catalogReady).toBe(false)
  response.resolve(json({ location: { directory }, data: recommended }))
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()).toEqual({ providerID: "kilo", modelID: first.id })
})

test.each([{ directory: `${directory}/other` }, { directory, workspaceID: "workspace_other" }])(
  "does not retain the previous location's recommendation while %j loads",
  async (other) => {
    const response = Promise.withResolvers<Response>()
    const started = Promise.withResolvers<void>()
    await using setup = await renderLocal({
      models: [first, recommended],
      fetch: (url) => {
        if (url.pathname !== "/api/model/default") return
        if (url.searchParams.get("location[directory]") === directory && !url.searchParams.has("location[workspaceID]"))
          return json({ location: { directory }, data: recommended })
        started.resolve()
        return response.promise.then((value) => value.clone())
      },
    })
    expect(setup.local.model.current()?.modelID).toBe(recommended.id)
    setup.location.set(other)
    await setup.data.location.sync(other)
    await started.promise
    expect(setup.local.model.selection()).toBeUndefined()
    expect(setup.local.model.catalogReady).toBe(false)
    response.resolve(json({ location: other, data: first }))
    await until(() => setup.local.model.catalogReady)
    expect(setup.local.model.current()?.modelID).toBe(first.id)
  },
)

test("a late default from another location cannot replace the current location's default", async () => {
  const response = Promise.withResolvers<Response>()
  const other = { directory: `${directory}/other`, workspaceID: "workspace_other" }
  const locations: URL[] = []
  await using setup = await renderLocal({
    models: [first, recommended],
    waitForDefault: false,
    fetch: (url) => {
      if (url.pathname !== "/api/model/default") return
      locations.push(url)
      if (url.searchParams.get("location[directory]") === directory)
        return response.promise.then((value) => value.clone())
      return json({ location: other, data: recommended })
    },
  })
  setup.location.set(other)
  await setup.data.location.sync(other)
  await until(() => setup.local.model.catalogReady)
  expect(setup.local.model.current()?.modelID).toBe(recommended.id)
  expect(locations.at(-1)?.searchParams.get("location[workspaceID]")).toBe(other.workspaceID)
  response.resolve(json({ location: { directory }, data: first }))
  await setup.renderOnce()
  expect(setup.local.model.current()?.modelID).toBe(recommended.id)
})

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for default model selection")
    await Bun.sleep(1)
  }
}
