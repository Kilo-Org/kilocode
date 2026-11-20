import { expect, test } from "bun:test"
import { AgentAvatar, AgentAvatarPalette } from "../src/components/agent-avatar"
import { identity, palette } from "../src/components/agent-avatar-identity"
import { mount } from "./harness"

test("a shared palette renders the selected fallback glyph", () => {
  // The ninth sibling repeats a glyph whose eight hues are already used.
  const ids = ["ses_108", "ses_117", "ses_180", "ses_250", "ses_276", "ses_333", "ses_346", "ses_391", "ses_438"]
  const shown = palette(ids).get(ids[8])
  if (!shown) throw new Error("Missing palette entry for the ninth sibling")
  const view = mount(() => (
    <AgentAvatarPalette ids={ids}>
      <AgentAvatar id={ids[8]} />
    </AgentAvatarPalette>
  ))
  const svg = view.host.querySelector('[data-component="agent-avatar"]')
  if (!svg) throw new Error("Missing rendered avatar")
  const lit = [...svg.querySelectorAll("circle[data-lit]")].map((circle) => {
    const cx = Number(circle.getAttribute("cx"))
    const cy = Number(circle.getAttribute("cy"))
    return ((cy - 1.5) / 4) * 5 + (cx - 1.5) / 4
  })

  expect(svg.getAttribute("data-color")).toBe(String(shown.color))
  expect(lit).toEqual(shown.cells)
  expect(lit).not.toEqual(identity(ids[8]).cells)
  view.dispose()
})
