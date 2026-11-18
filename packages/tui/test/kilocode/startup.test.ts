import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import { createData } from "@opencode/client/solid"
import { RGBA } from "@opentui/core"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createRoot, createSignal } from "solid-js"
import { InteractiveStartup } from "../../src/kilocode/interactive-startup"
import { initialCatalogWait, submissionCatalogsLoaded } from "../../src/kilocode/pending-submission"
import { startupTheme } from "../../src/kilocode/startup-theme"
import { getOpenCodeTheme } from "../../src/theme"
import { agent } from "../fixture/local"
import { createApi, createFetch, directory, json } from "../fixture/tui-client"

test.each(["loaded", "failed", "stalled"])("startup releases submission when a catalog is %s", (outcome) => {
  const deadline = new AbortController()
  const [loaded, setLoaded] = createSignal(false)
  const [failure, setFailure] = createSignal<{ cause: unknown }>()
  const errors: unknown[] = []
  const cause = new Error("model list unavailable")
  const gate = createRoot((dispose) => ({
    dispose,
    waiting: initialCatalogWait(loaded, failure, (err) => errors.push(err), deadline.signal),
  }))
  try {
    expect(gate.waiting()).toBe(true)
    if (outcome === "loaded") setLoaded(true)
    if (outcome === "failed") setFailure({ cause })
    deadline.abort(cause)
    expect(gate.waiting()).toBe(false)
    setLoaded(false)
    expect(gate.waiting()).toBe(false)
    expect(errors).toEqual(outcome === "loaded" ? [] : [cause])
  } finally {
    gate.dispose()
  }
})

test("the startup submit gate stays closed while agents are still loading", async () => {
  const location = { directory }
  const started = Promise.withResolvers<void>()
  const agents = Promise.withResolvers<Response>()
  const api = createApi(
    createFetch((url) => {
      if (url.pathname !== "/api/agent") return
      started.resolve()
      return agents.promise
    }).fetch,
  )
  const event = createGlobalEmitter<{ [Type in OpenCodeEvent["type"]]: Extract<OpenCodeEvent, { type: Type }> }>()
  const setup = createRoot((dispose) => ({ dispose, data: createData({ api: () => api, event, directory }) }))
  const response = json({ location, data: [agent("code")] })
  try {
    await Promise.all([setup.data.location.command.sync(location), setup.data.session.form.sync("global", location)])
    const pending = setup.data.location.agent.sync(location)
    await started.promise
    expect(submissionCatalogsLoaded(setup.data, location)).toBe(false)

    agents.resolve(response)
    await pending
    expect(submissionCatalogsLoaded(setup.data, location)).toBe(true)
  } finally {
    agents.resolve(response)
    setup.dispose()
  }
})

test("the early transport does not fetch until the lease is ready", async () => {
  let calls = 0
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++
      return new Response(null, { status: 204 })
    },
  })
  const ready = Promise.withResolvers<void>()
  const signal = new AbortController().signal
  const request = InteractiveStartup.transport(fetch, (waiting) => {
    expect(waiting).toBe(signal)
    return ready.promise
  })

  const first = request(server.url, { signal })
  expect(calls).toBe(0)
  ready.resolve()
  expect((await first).status).toBe(204)
  // Later requests need no startup wait or lease signal.
  expect((await request(server.url)).status).toBe(204)
  expect(calls).toBe(2)
})

test("the provisional theme leaves main and dialog foreground and background to the terminal", () => {
  const theme = resolveThemeDocument(getOpenCodeTheme(), "light")
  const pending = startupTheme(theme)
  for (const surface of [pending, pending.surface("dialog")]) {
    expect(surface.text.base.equals(RGBA.defaultForeground())).toBe(true)
    expect(surface.background.base.equals(RGBA.defaultBackground())).toBe(true)
    expect(surface.decrease(surface.background.raised.base).equals(RGBA.defaultBackground())).toBe(true)
  }
  expect(pending.text.feedback.warning.base).toBe(theme.text.feedback.warning.base)
})
