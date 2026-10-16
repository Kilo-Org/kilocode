// kilocode_change - new file
/**
 * Contract test for chmod(0o000) failure injections in kilo-sessions.test.ts.
 *
 * The heartbeat self-heal test breaks git with `chmod 0o000 .git` and asserts
 * the repository metadata disappears. On Windows chmod(0o000) is a no-op for
 * reads, and root ignores permission bits, so the injection cannot break git
 * there and the assertions spuriously fail. The file runs on Windows because
 * .github/workflows/test.yml schedules six windows shards that run the
 * packages/opencode unit tests with no exclusion. Every injection must skip
 * win32 and root first — the pattern in test/util/filesystem.test.ts
 * ("throws EACCES on permission-denied symlink target"). This test catches a
 * guard that was removed or copied without.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const TARGET = path.resolve(import.meta.dir, "kilo-sessions.test.ts")

describe("chmod(0o000) failure injections in kilo-sessions.test.ts", () => {
  test("the self-heal injection exists and is guarded against win32 and root", () => {
    const content = readFileSync(TARGET, "utf-8")
    const injections = [...content.matchAll(/\.chmod\([^)]*0o000\)/g)]
    // The e5 self-heal scenario must stay covered; dropping it is a contract
    // break too, so fail loudly instead of passing vacuously.
    expect(injections.length).toBeGreaterThan(0)
    for (const injection of injections) {
      // The enclosing test callback starts at the nearest preceding `test(`.
      const testStart = content.lastIndexOf("\n  test(", injection.index)
      expect(testStart).toBeGreaterThan(-1)
      const header = content.slice(testStart, injection.index)
      expect(header).toContain('if (process.platform === "win32") return')
      expect(header).toContain("if (process.getuid?.() === 0) return")
    }
  })
})
