import { expect, test } from "bun:test"
import { transformI18nContent } from "./transform-i18n"

test("marks transformed Kilo branding and preserves legacy config names", () => {
  const result = transformI18nContent(
    '  "product": "OpenCode",\n  "docs": "https://opencode.ai/docs",\n  "legacy": ".opencode/opencode.json",',
  )
  expect(result.result).toContain('"product": "Kilo", // kilocode_change')
  expect(result.result).toContain('"docs": "https://kilo.ai/docs", // kilocode_change')
  expect(result.result).toContain('"legacy": ".opencode/opencode.json",')
  expect(result.replacements).toBe(2)
})
