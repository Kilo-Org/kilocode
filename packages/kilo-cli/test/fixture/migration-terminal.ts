import { Database } from "bun:sqlite"
import path from "node:path"
import { preflight } from "../../src/migration/preflight"
import { terminalCutover } from "../../src/migration/terminal"

const root = process.env.KILO_TERMINAL_TEST_PROFILE
if (!root || process.cwd() !== root) throw new Error("Run this fixture only inside its generated test profile")
const plan = preflight({
  HOME: root,
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CONFIG_HOME: path.join(root, "config"),
})
try {
  const accepted = await terminalCutover(plan, async (report) => {
    report({ phase: "Backing up" })
    using db = new Database(plan.source, { readonly: true })
    db.run("VACUUM INTO ?", [plan.backup])
    const { total } = db.query<{ total: number }, []>("SELECT count(*) AS total FROM session").get()!
    report({ phase: "Checking sessions", done: 0, total })
    report({ phase: "Checking sessions", done: total, total })
  })
  console.log(`result: ${accepted}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
