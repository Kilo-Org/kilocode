/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ModelRow, UsageRow } from "@/kilocode/plugins/sidebar-usage-row"

test("model costs align with usage values", async () => {
  const app = await testRender(
    () => (
      <box width={36}>
        <UsageRow label="Cost" value="$0.54" color={RGBA.fromHex("#ffffff")} />
        <ModelRow
          label="GPT-5.6 Sol"
          steps="6"
          cost="$0.40"
          expanded={false}
          text={RGBA.fromHex("#ffffff")}
          muted={RGBA.fromHex("#ffffff")}
          toggle={() => {}}
        />
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
