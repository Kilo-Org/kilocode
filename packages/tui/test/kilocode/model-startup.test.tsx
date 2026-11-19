import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "node:path"
import { createAppFixture } from "../fixture/app"
import { tmpdir } from "../fixture/fixture"
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
  options: {
    agent?: string
    sync?: Promise<void>
    rejectPrompt?: boolean
    navigation?: "picker" | "child"
    state?: string
  } = {},
) {
  const saved = session(`ses_${crypto.randomUUID()}`, savedModel)
  const path = `/api/session/${saved.id}`
  const child = { ...session(`ses_${crypto.randomUUID()}`), parentID: saved.id, title: "Active child" }
  const childPath = `/api/session/${child.id}`
  // A historical switch shows publication in the transcript even with no composer mounted.
  const switched = { type: "model-switched", id: "msg_model", model: savedModel, time: { created: 0 } }
  const location = { directory }
  const writes: unknown[] = []
  const submitted = Promise.withResolvers<void>()
  const setup = await createAppFixture({
    state: options.state,
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
      if (options.navigation === "child") {
        if (url.pathname === "/api/session/active") return json({ data: { [child.id]: { type: "running" } } })
        if (url.pathname === childPath) return json({ data: child })
        if (url.pathname === `${childPath}/message`)
          return json({
            data: [{ type: "user", id: "msg_child", text: "Child transcript", time: { created: 1 } }, switched],
            cursor: {},
          })
        if (url.pathname === `${childPath}/inbox`) return json({ data: [], cursor: {} })
        if (url.pathname.startsWith(`${childPath}/`) && request.method === "POST") {
          writes.push({ path: url.pathname, body: await request.json() })
          return new Response(null, { status: 204 })
        }
      }
      if (url.pathname === path) return json({ data: saved })
      if (options.navigation && url.pathname === `${path}/message`) return json({ data: [switched], cursor: {} })
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
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("No active subagents"))
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedEditor?.plainText === prompt)
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

test("undoing an edit on the remounted composer does not re-arm the launch draft", async () => {
  await using app = await resume()
  await app.ready
  await app.waitForFrame((frame) => frame.includes("saved (unavailable)") && frame.includes(prompt))
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("No active subagents"))
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedEditor?.plainText === prompt)
  app.mockInput.pressKey("x")
  expect(app.renderer.currentFocusedEditor?.plainText, "typed editor").toBe(prompt + "x")
  app.mockInput.pressKey("-", { ctrl: true })
  expect(app.renderer.currentFocusedEditor?.plainText, "after native undo").toBe(prompt)
  app.update([{ ...selected, name: "Available model" }])
  await app.waitForFrame((frame) => frame.includes("Available model"))
  expect(app.renderer.currentFocusedEditor?.plainText, "after publication following undo").toBe(prompt)
  expect(app.writes).toEqual([])
})

test("recalling identical user text from history before a remount leaves it for manual send", async () => {
  await using state = await tmpdir()
  const history = Bun.file(path.join(state.path, "prompt-history.jsonl"))
  await Bun.write(history, ["Older draft", prompt].map((text) => JSON.stringify({ text, pasted: [] })).join("\n"))
  await using app = await resume([], { state: state.path })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("saved (unavailable)") && frame.includes(prompt))
  await app.waitFor(async () => (await history.text()).endsWith("\n"))
  app.mockInput.pressArrow("up")
  expect(app.renderer.currentFocusedEditor?.cursorOffset, "history starts at the first column").toBe(0)
  app.mockInput.pressArrow("up")
  expect(app.renderer.currentFocusedEditor?.plainText, "after recalling identical text").toBe(prompt)
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("No active subagents"))
  app.mockInput.pressEscape()
  await app.waitForFrame(() => app.renderer.currentFocusedEditor?.plainText === prompt)
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

test.each([
  { away: "picker", publication: "while away" },
  { away: "picker", publication: "after return" },
  { away: "child", publication: "while away" },
  { away: "child", publication: "after return" },
] as const)(
  "an untouched launch draft submits once after $away navigation, published $publication",
  async ({ away, publication }) => {
    await using app = await resume([], { navigation: away })
    await app.ready
    await app.waitForFrame(
      (frame) => frame.includes("saved (unavailable)") && app.renderer.currentFocusedEditor?.plainText === prompt,
    )
    const original = app.renderer.currentFocusedEditor
    app.mockInput.pressKey("F7")
    await app.waitForFrame((frame) => frame.includes(away === "child" ? "Active child" : "No active subagents"))
    if (away === "child") {
      app.mockInput.pressEnter()
      await app.waitForFrame((frame) => frame.includes("Child transcript"))
    }
    expect(original?.isDestroyed).toBe(true)
    if (publication === "while away") {
      app.update([{ ...selected, name: "Published model" }])
      await app.waitForFrame((frame) => frame.includes("Switched model to Published model"))
    }
    expect(app.writes).toEqual([])
    app.mockInput.pressEscape()
    if (publication === "after return") {
      await app.waitForFrame(() => app.renderer.currentFocusedEditor?.plainText === prompt)
      expect(app.renderer.currentFocusedEditor).not.toBe(original)
      app.update([{ ...selected, name: "Published model" }])
    }
    await app.waitForFrame(
      (frame) =>
        frame.includes("Published model") &&
        app.renderer.currentFocusedEditor?.plainText === "" &&
        app.writes.length >= 2,
    )
    expect(app.writes).toEqual([{ model: savedModel }, expect.objectContaining({ text: prompt })])
    app.update([{ ...selected, name: "Refreshed model" }])
    await app.waitForFrame((frame) => frame.includes("Refreshed model"))
    expect(app.writes).toHaveLength(2)
  },
)

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
