import { expect, test } from "bun:test"
import { KiloBrandingRules } from "../src/branding/rules"

const span = (text: string, bareStringLiteral = false) => KiloBrandingRules.brandSpan(text, { bareStringLiteral })

test("brands the product word and the command token", () => {
  expect(span("OpenCode crashed")).toBe("Kilo crashed")
  expect(span("run opencode now")).toBe("run kilo2 now")
  expect(span("OpenCode runs opencode")).toBe("Kilo runs kilo2")
})

test("brands domains, the upstream repo and the config file name", () => {
  expect(span("see https://opencode.ai/docs")).toBe("see https://kilo.ai/docs")
  expect(span("github.com/anomalyco/opencode/issues")).toBe("github.com/Kilo-Org/kilocode/issues")
  expect(span("opencode.ai")).toBe("kilo.ai")
  expect(span("edit opencode.json")).toBe("edit kilo2.json")
})

test("leaves the bare executable-name string literal alone", () => {
  // `command: "opencode"` resolves at runtime; a template token does not.
  expect(span("opencode", true)).toBe("opencode")
  expect(span("opencode", false)).toBe("kilo2")
})

test("does not touch code that only looks like branding", () => {
  // The command token must not fire inside an import specifier or a dotted ID.
  expect(span("@opencode/core")).toBe("@opencode/core")
  expect(span("opencode.app.exit")).toBe("opencode.app.exit")
})
