import { expect, test } from "bun:test"
import { join } from "node:path"

test("compaction export derives root session from KiloSession", async () => {
  const root = join(import.meta.dir, "../../..")
  const text = await Bun.file(join(root, "src/session/compaction.ts")).text()
  const block = text.slice(
    text.indexOf("// kilocode_change start - export self-contained compaction capture"),
    text.indexOf("yield* prune({ sessionID"),
  )
  expect(block).toContain("KiloSession.resolveRoot(input.sessionID)")
})
