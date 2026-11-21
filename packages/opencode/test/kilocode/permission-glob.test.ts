import { test, expect, describe } from "bun:test"
import z from "zod"
import { regexToGlobs } from "../../src/kilocode/permission-glob"

// Shared with the Kotlin translator's suite (LegacyMigrationConversionTest, `fileRegexToGlobs`),
// so the two translators cannot drift apart without a test failure on one side.
const FIXTURE = `${import.meta.dir}/../../../kilo-jetbrains/backend/src/test/resources/migration/permission-glob-cases.json`

/** `globs: null` means the translator rejects the pattern and the caller reports it. */
const GlobCase = z.object({
  name: z.string().min(1),
  regex: z.string(),
  globs: z.array(z.string()).nullable(),
})

const cases = z.array(GlobCase).parse(await Bun.file(FIXTURE).json())

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
