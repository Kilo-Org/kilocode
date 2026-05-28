// kilocode_change - new file
import { expect, test } from "bun:test"
import css from "./select.css" with { type: "text" }

const src = await Bun.file(new URL("./select.tsx", import.meta.url)).text()

test("settings select uses horizontal viewport collision handling", () => {
  expect(src).toContain('placement={local.triggerVariant === "settings" ? "bottom-end" : "bottom-start"}')
  expect(src).toContain('overlap={local.triggerVariant === "settings"}')
  expect(src).toContain('fitViewport={local.triggerVariant === "settings"}')
  expect(src).toContain('overflowPadding={local.triggerVariant === "settings" ? 12 : undefined}')
})

test("settings select content is constrained by available popper width", () => {
  expect(css).toContain("max-width: min(23rem, var(--kb-popper-content-available-width));")
})
