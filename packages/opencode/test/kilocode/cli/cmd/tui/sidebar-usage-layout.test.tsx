/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"

test("model costs align with usage values", async () => {
  const app = await testRender(
    () => (
      <box width={36}>
        <box flexDirection="row" justifyContent="space-between">
          <text>Cost</text>
          <text>$0.54</text>
        </box>
        <box>
          <box flexDirection="row" gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1} minWidth={0} overflow="hidden">
              <text>▶</text>
              <text>GPT-5.6 Sol</text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <box width={5} flexDirection="row" justifyContent="flex-end">
                <text>6</text>
              </box>
              <box width={9} flexDirection="row" justifyContent="flex-end">
                <text>$0.40</text>
              </box>
            </box>
          </box>
        </box>
      </box>
    ),
    { width: 36, height: 3 },
  )

  try {
    await app.renderOnce()
    const lines = app.captureCharFrame().split("\n")
    expect(lines[0]!.lastIndexOf("4")).toBe(lines[1]!.lastIndexOf("0"))
  } finally {
    app.renderer.destroy()
  }
})
