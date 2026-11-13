import { expect, test } from "bun:test"
import { createCaffeinationDriver } from "@kilocode/caffeination"
import { createAppFixture } from "../fixture/app"

test.skipIf(!createCaffeinationDriver().available)(
  "/caffeinate asks for confirmation before enabling Keep Awake",
  async () => {
    await using app = await createAppFixture()
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    await app.mockInput.typeText("/caffeinate")
    await app.waitForFrame((frame) => frame.includes("Prevent system sleep while Kilo agents work"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Keep this computer awake while Kilo agents work?"))

    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => !frame.includes("Keep this computer awake while Kilo agents work?"))
    expect(app.captureCharFrame()).not.toContain("Keep Awake enabled")
  },
  30000,
)
