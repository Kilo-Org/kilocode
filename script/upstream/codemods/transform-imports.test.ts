import { expect, test } from "bun:test"
import { Project } from "ts-morph"
import { transformImports } from "./transform-imports"

test("reports and rewrites mapped imports, exports, dynamic imports, and requires", () => {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile(
    "/a.ts",
    [
      'import { tool } from "@opencode/plugin"',
      'export { x } from "@opencode/sdk/v2"',
      'const a = await import("@opencode/cli")',
      'const b = require("@opencode/sdk")',
      'import { y } from "@opencode/client"',
      "",
    ].join("\n"),
  )

  const changes = transformImports(sourceFile)

  expect(changes.map((change) => `${change.before} -> ${change.after}`)).toEqual([
    "@opencode/plugin -> @kilocode/plugin",
    "@opencode/sdk/v2 -> @kilocode/sdk/v2",
    "@opencode/cli -> @kilocode/cli",
    "@opencode/sdk -> @kilocode/sdk",
  ])
  expect(changes.map((change) => change.line)).toEqual([1, 2, 3, 4])
  expect(changes[0].file).toBe("/a.ts")

  const text = sourceFile.getFullText()
  expect(text).toContain('from "@kilocode/plugin"')
  expect(text).toContain('from "@kilocode/sdk/v2"')
  expect(text).toContain('import("@kilocode/cli")')
  expect(text).toContain('require("@kilocode/sdk")')
  expect(text).toContain('from "@opencode/client"')
})

test("leaves the external @opencode-ai packages that upstream v2 still uses", () => {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile("/b.ts", 'import { x } from "@opencode-ai/pty"\n')

  expect(transformImports(sourceFile)).toEqual([])
  expect(sourceFile.getFullText()).toContain('"@opencode-ai/pty"')
})
