import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { resolve, TuiConfigProvider, useTuiConfig } from "../../src/config"

test("preserves reactive configuration reads through the provider", async () => {
  const [theme, update] = createSignal("first")
  const config = {
    ...resolve({}, { terminalSuspend: true }),
    get theme() {
      return theme()
    },
  }
  function Consumer() {
    const value = useTuiConfig()
    return <text>{value.theme}</text>
  }
  const app = await testRender(() => (
    <TuiConfigProvider config={config}>
      <Consumer />
    </TuiConfigProvider>
  ))
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("first")
    update("next")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("next")
  } finally {
    app.renderer.destroy()
  }
})
