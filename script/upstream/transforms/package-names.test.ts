import { expect, test } from "bun:test"
import { applyPackageNameTransforms } from "./package-names"
import { defaultConfig } from "../utils/config"

const brandingOn = { ...defaultConfig, transforms: { ...defaultConfig.transforms, branding: true } }

test("renames mapped package names and keeps subpaths", () => {
  const input = 'import { tool } from "@opencode/plugin"\nconst p = "@opencode/cli/v2"\n'
  const { result, changes } = applyPackageNameTransforms(input)
  expect(result).toBe('import { tool } from "@kilocode/plugin"\nconst p = "@kilocode/cli/v2"\n')
  expect(changes).toBe(2)
})

test("does not rename longer packages that share a prefix", () => {
  const input = 'import { x } from "@opencode/client"\n'
  expect(applyPackageNameTransforms(input).result).toBe(input)
})

test("keeps the external @opencode-ai packages that upstream v2 still uses", () => {
  const input = 'import { x } from "@opencode-ai/pty"\nimport { y } from "@opencode-ai/sdk"\n'
  expect(applyPackageNameTransforms(input).result).toBe(input)
})

test("applies brand tokens only when branding is on", () => {
  const input = "OPENCODE_FLAG x-opencode-request opencode.db window.__OPENCODE__"
  expect(applyPackageNameTransforms(input).result).toBe(input)
  expect(applyPackageNameTransforms(input, brandingOn).result).toBe(
    "KILO_FLAG x-kilo-request kilo.db window.__KILO__",
  )
})
