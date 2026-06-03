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

test("llm export does not retain raw stream parts", async () => {
  const root = join(import.meta.dir, "../../..")
  const llm = await Bun.file(join(root, "src/session/llm.ts")).text()
  const events = await Bun.file(join(root, "src/kilocode/session-export/events.ts")).text()
  expect(llm).not.toContain("rawParts")
  expect(events).not.toContain("rawParts")
})

test("workspace git subprocesses are hidden on Windows", async () => {
  const root = join(import.meta.dir, "../../..")
  const text = await Bun.file(join(root, "src/kilocode/session-export/workspace-provider.ts")).text()
  const spawns = [...text.matchAll(/Bun\.spawn\(\["git"[\s\S]*?\n  \}\)/g)]
  expect(spawns).toHaveLength(2)
  expect(spawns.every((spawn) => spawn[0].includes("windowsHide: true"))).toBe(true)
})
