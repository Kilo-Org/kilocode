import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const configPath = `${directory}/kilo2.json`

test("/about opens from the slash menu and shows the diagnostics, masking paths in privacy mode", async () => {
  const privacy = { enabled: false }
  await using app = await createAppFixture({
    fetch: (url) => {
      if (url.pathname === "/api/config") return json([{ type: "document", path: configPath, info: {} }])
      if (url.pathname === "/api/integration")
        return json({
          location: { directory },
          data: [
            { id: "kilo", name: "Kilo Gateway", methods: [], connections: [{ type: "env", name: "KILO_API_KEY" }] },
          ],
        })
      if (url.pathname === "/api/rpc/kilocode.privacy/get")
        return json({ output: { enabled: privacy.enabled } })
      return undefined
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  await app.mockInput.typeText("/about")
  await app.waitForFrame((frame) => frame.includes("Show version, environment, and diagnostic info"))
  app.mockInput.pressEnter()
  // Wait for privacyMode() to resolve (paths visible means it resolved to off).
  await app.waitForFrame(
    (frame) => frame.includes("About Kilo CLI") && frame.includes(configPath) && !frame.includes("\u2022\u2022\u2022"),
  )

  const frame = app.captureCharFrame()
  expect(frame).toMatch(/Version\s+test/)
  expect(frame).toMatch(/Channel\s+test/)
  expect(frame).toContain(configPath)
  expect(frame).toContain(directory)
  expect(frame).toMatch(/Connected\s+kilo/)
  expect(frame).toMatch(/Default model\s+\(none\)/)
  expect(frame).toContain("https://kilo.ai/docs")
  expect(frame).not.toContain("\u2022\u2022\u2022")

  privacy.enabled = true
  app.events.emit({ id: "evt_about_on", type: "config.updated", created: 1, location: { directory }, data: {} })
  await app.waitForFrame((frame) => frame.includes("\u2022\u2022\u2022"))
  const masked = app.captureCharFrame()
  expect(masked).not.toContain(configPath)
  expect(masked).not.toContain(directory)
  expect(masked).toMatch(/Version\s+test/)
})
