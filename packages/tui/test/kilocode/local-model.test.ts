import { afterEach, beforeEach, expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"
import { agent, model, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

const previous = process.env.OPENCODE_APP_DIR_NAME
beforeEach(() => {
  process.env.OPENCODE_APP_DIR_NAME = "kilo2"
})
afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_APP_DIR_NAME
  else process.env.OPENCODE_APP_DIR_NAME = previous
})

function launch(state: string, options: { pin?: string; models?: string[]; resume?: boolean } = {}) {
  const saved = session("ses_saved", { providerID: "provider", id: "durable" })
  const location = { directory }
  return createAppFixture({
    state,
    config: {
      animations: false,
      keybinds: {
        "agent.cycle": "f6",
        "model.list": "f8",
        "model.dialog.favorite": "f9",
        "model.cycle_favorite": "f10",
      },
    },
    args: options.resume ? { sessionID: saved.id } : {},
    fetch: (url) => {
      if (url.pathname === "/api/config") return json([{ type: "document", info: { model: "provider/global" } }])
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [agent("build", options.pin ? { providerID: "provider", id: options.pin } : undefined), agent("plan")],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: (options.models ?? ["global", "alpha", "beta", "durable"]).map((id) => ({
            ...model(id),
            name: `Model ${id}`,
          })),
        })
      if (url.pathname === `/api/session/${saved.id}`) return json({ data: saved })
      if (url.pathname === `/api/session/${saved.id}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${saved.id}/inbox`) return json({ data: [] })
    },
  })
}

type App = Awaited<ReturnType<typeof launch>>

async function expectModel(app: App, agent: string, id: string) {
  await app.ready
  const footer = `${agent} · Model ${id}`
  const frame = await app.waitForFrame(
    (frame) => frame.includes(footer) && app.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  expect(frame).toContain(footer)
}

async function pick(app: App, agent: string, id: string, favorite = false) {
  app.mockInput.pressKey("F8")
  await app.waitForFrame(
    (frame) => frame.includes("Select model") && app.renderer.currentFocusedRenderable instanceof InputRenderable,
  )
  await app.mockInput.typeText(id)
  await app.renderOnce()
  if (favorite) app.mockInput.pressKey("F9")
  app.mockInput.pressEnter()
  await expectModel(app, agent, id)
}

test("fresh TUI restores each agent's explicit pick ahead of the top-level model", async () => {
  await using state = await tmpdir()
  {
    await using app = await launch(state.path)
    await expectModel(app, "Build", "global")
    await pick(app, "Build", "alpha")
    app.mockInput.pressKey("F6")
    await expectModel(app, "Plan", "global")
    await pick(app, "Plan", "beta")
  }
  await using restarted = await launch(state.path)
  await expectModel(restarted, "Build", "alpha")
  restarted.mockInput.pressKey("F6")
  await expectModel(restarted, "Plan", "beta")
})

test("unhosted TUI neither restores nor overwrites Kilo's per-agent selection", async () => {
  await using state = await tmpdir()
  {
    await using hosted = await launch(state.path)
    await expectModel(hosted, "Build", "global")
    await pick(hosted, "Build", "alpha")
  }
  delete process.env.OPENCODE_APP_DIR_NAME
  {
    await using upstream = await launch(state.path)
    await expectModel(upstream, "Build", "global")
    await pick(upstream, "Build", "beta")
  }
  process.env.OPENCODE_APP_DIR_NAME = "kilo2"
  await using hosted = await launch(state.path)
  await expectModel(hosted, "Build", "alpha")
})

test("agent pin wins over an older pick and a later override lasts only for this run", async () => {
  await using state = await tmpdir()
  {
    await using app = await launch(state.path)
    await expectModel(app, "Build", "global")
    await pick(app, "Build", "alpha")
  }
  {
    await using pinned = await launch(state.path, { pin: "durable" })
    await expectModel(pinned, "Build", "durable")
    await pick(pinned, "Build", "beta")
    pinned.mockInput.pressKey("F6")
    await expectModel(pinned, "Plan", "global")
    pinned.mockInput.pressKey("F6")
    await expectModel(pinned, "Build", "beta")
  }
  {
    await using restarted = await launch(state.path, { pin: "durable" })
    await expectModel(restarted, "Build", "durable")
  }
  await using unpinned = await launch(state.path)
  await expectModel(unpinned, "Build", "global")
})

test("an unavailable pick falls back to config; resuming still uses the session's model", async () => {
  await using state = await tmpdir()
  {
    await using app = await launch(state.path)
    await expectModel(app, "Build", "global")
    await pick(app, "Build", "alpha")
  }
  {
    await using restarted = await launch(state.path, { models: ["beta", "global"] })
    await expectModel(restarted, "Build", "global")
  }
  {
    await using resumed = await launch(state.path, { resume: true })
    await expectModel(resumed, "Build", "durable")
    await pick(resumed, "Build", "beta")
  }
  await using fresh = await launch(state.path)
  await expectModel(fresh, "Build", "beta")
})

test("recent and favorite shortcuts persist their new selection across restarts", async () => {
  await using state = await tmpdir()
  {
    await using app = await launch(state.path)
    await expectModel(app, "Build", "global")
    await pick(app, "Build", "alpha")
    await pick(app, "Build", "beta", true)
    app.mockInput.pressKey("F2")
    await expectModel(app, "Build", "alpha")
  }
  {
    await using restarted = await launch(state.path)
    await expectModel(restarted, "Build", "alpha")
    restarted.mockInput.pressKey("F10")
    await expectModel(restarted, "Build", "beta")
  }
  await using restarted = await launch(state.path)
  await expectModel(restarted, "Build", "beta")
})
