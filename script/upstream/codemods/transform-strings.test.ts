import { expect, test } from "bun:test"
import { Project } from "ts-morph"
import { transformStrings } from "./transform-strings"

test("reports and rewrites package names and brand tokens", () => {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile(
    "/a.ts",
    [
      'const a = "@opencode/plugin"',
      'const b = "npx opencode"',
      'const c = "OPENCODE_TOKEN"',
      'const d = "x-opencode-request"',
      'const e = "opencode.db"',
      'const f = `npx opencode ${x}`',
      'const g = "keep @opencode-ai/pty"',
      "",
    ].join("\n"),
  )

  const changes = transformStrings(sourceFile)

  expect(changes.map((change) => change.after)).toEqual([
    '"@kilocode/plugin"',
    '"npx @kilocode/cli"',
    '"KILO_TOKEN"',
    '"x-kilo-request"',
    '"kilo.db"',
    "`npx @kilocode/cli ${",
  ])
  expect(changes.map((change) => change.line)).toEqual([1, 2, 3, 4, 5, 6])

  const text = sourceFile.getFullText()
  expect(text).toContain('"@kilocode/plugin"')
  expect(text).toContain('"npx @kilocode/cli"')
  expect(text).toContain('"KILO_TOKEN"')
  expect(text).toContain('"x-kilo-request"')
  expect(text).toContain('"kilo.db"')
  expect(text).toContain("`npx @kilocode/cli ${x}`")
  expect(text).toContain('"keep @opencode-ai/pty"')
})

test("excludes the upstream Zen SaaS key from the env prefix rewrite", () => {
  const project = new Project({ useInMemoryFileSystem: true })
  const sourceFile = project.createSourceFile("/b.ts", 'const key = "OPENCODE_API_KEY"\n')

  expect(transformStrings(sourceFile)).toEqual([])
})
