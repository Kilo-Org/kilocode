import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"

// `/reload` is gone: a config save hot-reloads every location, so the Kilo command host shadows upstream's
// `location.reload` with a command that has no slash entry, palette entry or binding.
test("the reload slash command and its palette entry are removed", async () => {
  await using app = await createAppFixture()
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  // The typed text is `/relo`; a live slash entry would add `/reload` to the frame.
  app.mockInput.typeText("/relo")
  await Bun.sleep(100)
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("/reload")
  app.mockInput.pressEscape()

  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  app.mockInput.typeText("Reload configuration")
  await app.waitForFrame((frame) => frame.includes("No results found"))
})
