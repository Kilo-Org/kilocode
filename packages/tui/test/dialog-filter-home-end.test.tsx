// kilocode_change - new file
import type { TuiPluginApi } from "@kilocode/plugin/tui"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { expect, mock, test } from "bun:test"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory } from "./fixture/tui-sdk"

async function wait(fn: () => boolean, timeout = 10000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("home/end keys move the text cursor in a dialog filter input", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  let api: TuiPluginApi | undefined
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started()
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await ready
    await setup.renderOnce()
    await setup.renderOnce()

    let found: TextareaRenderable | undefined
    await wait(() => {
      const focused = setup.renderer.currentFocusedEditor
      if (!(focused instanceof TextareaRenderable)) return false
      if (focused.placeholder !== "Search") return false
      found = focused
      return true
    })
    const filter = found
    if (!filter) throw new Error("expected focused dialog filter input")

    await setup.mockInput.typeText("hello")
    await wait(() => filter.plainText === "hello")
    expect(filter.cursorOffset).toBe(5)

    setup.mockInput.pressArrow("left")
    setup.mockInput.pressArrow("left")
    await setup.flush()
    expect(filter.cursorOffset).toBe(3)

    setup.mockInput.pressKey("END")
    await setup.flush()
    expect(filter.cursorOffset).toBe(5)

    setup.mockInput.pressKey("HOME")
    await setup.flush()
    expect(filter.cursorOffset).toBe(0)

    void api?.keymap.dispatchCommand("app.exit")
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
  }
})
