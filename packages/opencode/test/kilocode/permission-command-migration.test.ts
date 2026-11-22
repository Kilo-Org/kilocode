import { test, expect, describe } from "bun:test"
import z from "zod"
import { Permission } from "../../src/permission"

// Shared with the JetBrains migrator's suite (LegacyMigrationConversionTest,
// `convertAutoApproval - command rules match the shared case fixture`). The Kotlin side compares
// the produced bash rule map; this side feeds that map to the permission engine the CLI uses, so a
// migrated command list is checked by its decisions and not by its shape alone.
const FIXTURE = `${import.meta.dir}/../../../kilo-jetbrains/backend/src/test/resources/migration/command-rule-cases.json`

const Case = z.object({
  name: z.string().min(1),
  autoApprovalEnabled: z.boolean().nullable(),
  alwaysAllowExecute: z.boolean().nullable(),
  allowed: z.array(z.string()),
  denied: z.array(z.string()),
  bash: z.record(z.string(), z.enum(["allow", "ask", "deny"])).nullable(),
  decisions: z.record(z.string(), z.enum(["allow", "ask", "deny"])),
})

const cases = z.array(Case).parse(await Bun.file(FIXTURE).json())

describe("migrated command rules", () => {
  test("fixture is not empty", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const row of cases) {
    test(row.name, () => {
      // A row with no bash rule leaves the engine on its own defaults, so the map is empty.
      const rules = Permission.fromConfig({ bash: row.bash ?? {} })
      const decisions = Object.fromEntries(
        Object.keys(row.decisions).map((command) => [command, Permission.evaluate("bash", command, rules).action]),
      )
      expect({ name: row.name, decisions }).toEqual({ name: row.name, decisions: row.decisions })
    })
  }
})
