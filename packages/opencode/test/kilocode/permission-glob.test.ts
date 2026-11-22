import { test, expect, describe } from "bun:test"
import z from "zod"
import { regexToGlobs } from "../../src/kilocode/permission-glob"
import { pattern } from "../../src/kilocode/mcp/tool-id"

// Shared with the Kotlin translator's suite (LegacyMigrationConversionTest, `fileRegexToGlobs`),
// so the two translators cannot drift apart without a test failure on one side.
const FIXTURE = `${import.meta.dir}/../../../kilo-jetbrains/backend/src/test/resources/migration/permission-glob-cases.json`

// Shared with the Kotlin migrator's suite (LegacyMigrationConversionTest, `permissionRuleKey`).
// The CLI's tool-id naming is the authority, so a server name the two languages sanitize
// differently fails a suite on one side.
const KEYS = `${import.meta.dir}/../../../kilo-jetbrains/backend/src/test/resources/migration/permission-key-cases.json`

/** `globs: null` means the translator rejects the pattern and the caller reports it. */
const GlobCase = z.object({
  name: z.string().min(1),
  regex: z.string(),
  globs: z.array(z.string()).nullable(),
})

const KeyCase = z.object({
  server: z.string().min(1),
  key: z.string().min(1),
})

const cases = z.array(GlobCase).parse(await Bun.file(FIXTURE).json())
const keys = z.array(KeyCase).parse(await Bun.file(KEYS).json())

describe("regexToGlobs", () => {
  test("fixture is not empty", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const row of cases) {
    test(row.name, () => {
      // The row name appears in both the test title and the compared object, so a drifted
      // case is named in the failure instead of showing bare string arrays.
      expect({ name: row.name, globs: regexToGlobs(row.regex) }).toEqual({ name: row.name, globs: row.globs })
    })
  }
})

describe("pattern", () => {
  test("key fixture is not empty", () => {
    expect(keys.length).toBeGreaterThan(0)
  })

  for (const row of keys) {
    test(row.server, () => {
      expect({ server: row.server, key: pattern(row.server) }).toEqual({ server: row.server, key: row.key })
    })
  }
})
