import { afterEach, beforeEach, expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { agent, model, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

const prompt = "Resume this session"
const selected = { ...model("saved", ["high"]), providerID: "kilo" }
const savedModel = { providerID: selected.providerID, id: selected.id, variant: "high" }

const originalHost = process.env.OPENCODE_APP_DIR_NAME
beforeEach(async () => {
  await import("../../src/app") // Do not change other tests' process-wide built-in plugin registry.
  process.env.OPENCODE_APP_DIR_NAME = "kilo2"
})
afterEach(() => {
  if (originalHost === undefined) delete process.env.OPENCODE_APP_DIR_NAME
  else process.env.OPENCODE_APP_DIR_NAME = originalHost
})

async function resume(
  catalog: (typeof selected)[] = [],
  options: { agent?: string; sync?: Promise<void>; rejectPrompt?: boolean } = {},
) {
  const saved = session(`ses_${crypto.randomUUID()}`, savedModel)
  const path = `/api/session/${saved.id}`
  const location = { directory }
  const writes: unknown[] = []
  const submitted = Promise.withResolvers<void>()
  const setup = await createAppFixture({
    args: { sessionID: saved.id, prompt, agent: options.agent },
    config: {
      animations: false,
      tabs: { mode: "off" },
      keybinds: { "agent.cycle": "f6", "session.child.first": "f7", "diff.open": "f8" },
    },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build"), agent("plan")] })
      if (url.pathname === "/api/model") return json({ location, data: catalog })
      if (url.pathname === "/api/vcs/base")
        return json({ location, data: { name: "v2", ref: "refs/heads/v2", source: "default" } })
      if (url.pathname === "/api/vcs/diff") return json({ location, data: [] })
      if (url.pathname === path) return json({ data: saved })
      if (url.pathname === `${path}/permission`) {
        await options.sync
        return json({ data: [] })
      }
      if ([`${path}/message`, `${path}/inbox`].includes(url.pathname)) return json({ data: [], cursor: {} })
      if (url.pathname === `${path}/model` || url.pathname === `${path}/agent`) {
        writes.push(await request.json())
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `${path}/prompt`) {
        const body = await request.json()
        writes.push(body)
        submitted.resolve()
        if (options.rejectPrompt) return new Response(null, { status: 409 })
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
      }
    },
  })
  return {
    ...setup,
    writes,
    submitted: submitted.promise,
    update(models: typeof catalog) {
      catalog = models
      setup.events.emit({ id: `evt_${crypto.randomUUID()}`, type: "model.updated", created: 1, location, data: {} })
    },
  }
}

test("an initial prompt retains its saved model and submits once after model.updated", async () => {
  await using app = await resume()
  await app.ready
  const cold = await app.waitForFrame((frame) => frame.includes("saved (unavailable)") && frame.includes(prompt))
  expect(cold).not.toContain("Model unavailable")
  expect(app.writes).toEqual([])

  app.update([model("saved"), selected])
  await app.submitted
  app.update([{ ...selected, name: "Refreshed model" }])
  await app.waitForFrame((frame) => frame.includes("Refreshed model"))
  expect(app.writes).toEqual([{ model: savedModel }, expect.objectContaining({ text: prompt })])
})

test("a launch prompt waits for the composer when its model arrives while the diff panel owns input", async () => {
  await using app = await resume()
  app.resize(180, 36)
  await app.ready
  await app.waitForFrame((frame) => frame.includes("saved (unavailable)") && frame.includes(prompt))
  app.mockInput.pressKey("F8")
  await app.waitForFrame(() => app.renderer.currentFocusedRenderable?.id === "session-panel")

  app.update([{ ...selected, name: "Published model" }])
  await app.waitForFrame((frame) => frame.includes("Published model"))
  expect(app.writes).toEqual([])
  app.mockInput.pressKey("q")
  await app.submitted
  app.update([{ ...selected, name: "Refreshed model" }])
  await app.waitForFrame((frame) => frame.includes("Refreshed model"))
  expect(app.writes).toEqual([{ model: savedModel }, expect.objectContaining({ text: prompt })])
})

test("a rejected request restores the launch draft without resending it on a model update", async () => {
  await using app = await resume([selected], { rejectPrompt: true })
  await app.submitted
  await app.waitForFrame(
    (frame) => frame.includes("Failed to send prompt") && app.renderer.currentFocusedEditor?.plainText === prompt,
  )
  app.update([{ ...selected, name: "Refreshed model" }])
  await app.waitForFrame((frame) => frame.includes("Refreshed model"))
  expect(app.writes).toEqual([{ model: savedModel }, expect.objectContaining({ text: prompt })])
})

test("editing the waiting startup draft disarms auto-send even if its text is restored", async () => {
  const sync = Promise.withResolvers<void>()
  await using app = await resume([], { sync: sync.promise })
  await app.ready
  await app.waitForFrame(
    (frame) => frame.includes("saved (unavailable)") && app.renderer.currentFocusedEditor?.plainText === prompt,
  )
  await app.mockInput.typeText("!")
  app.mockInput.pressBackspace()
  expect(app.renderer.currentFocusedEditor?.plainText).toBe(prompt)

  sync.resolve()
  app.update([{ ...selected, name: "Available model" }])
  await app.waitForFrame((frame) => frame.includes("Available model"))
  expect(app.renderer.currentFocusedEditor?.plainText).toBe(prompt)
  expect(app.writes).toEqual([])
})

test("a missing saved model leaves the launch draft for an explicit send with a replacement", async () => {
  const replacement = model("replacement")
  const sync = Promise.withResolvers<void>()
  await using app = await resume([replacement], { sync: sync.promise })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("saved (unavailable)") && frame.includes(prompt))
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Plan") && frame.includes(replacement.name))
  sync.resolve()
  app.update([{ ...replacement, name: "User selection" }])
  await app.waitForFrame((frame) => frame.includes("User selection"))
  expect(app.renderer.currentFocusedEditor?.plainText).toBe(prompt)
  expect(app.writes).toEqual([])

  app.mockInput.pressEnter()
  await app.submitted
  expect(app.writes).toEqual([
    { agent: "plan" },
    { model: { providerID: replacement.providerID, id: replacement.id } },
    expect.objectContaining({ text: prompt }),
  ])
})

test("replacing the seeded composer with a restored draft does not auto-submit", async () => {
  await using app = await resume()
  await app.ready
  await app.waitForFrame(
    (frame) => frame.includes("saved (unavailable)") && app.renderer.currentFocusedEditor?.plainText === prompt,
  )
  const original = app.renderer.currentFocusedEditor
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("No active subagents"))
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedEditor?.plainText === prompt)
  expect(app.renderer.currentFocusedEditor).not.toBe(original)
  app.update([{ ...selected, name: "Available model" }])
  await app.waitForFrame((frame) => frame.includes("Available model"))
  expect(app.renderer.currentFocusedEditor?.plainText).toBe(prompt)
  expect(app.writes).toEqual([])
})

test("an explicit agent on resume uses its own model", async () => {
  const replacement = model("replacement")
  await using app = await resume([replacement], { agent: "plan" })
  await app.ready
  await app.submitted
  expect(app.writes).toEqual([
    { agent: "plan" },
    { model: { providerID: replacement.providerID, id: replacement.id } },
    expect.objectContaining({ text: prompt }),
  ])
})

test("unhosted startup keeps its original unavailable-model behavior", async () => {
  delete process.env.OPENCODE_APP_DIR_NAME
  await using app = await resume()
  await app.ready
  await app.waitForFrame((frame) => frame.includes("Model unavailable"))
  app.update([{ ...selected, name: "Available model" }])
  await app.waitForFrame((frame) => frame.includes("Available model"))
  expect(app.renderer.currentFocusedEditor?.plainText).toBe(prompt)
  expect(app.writes).toEqual([])
})
