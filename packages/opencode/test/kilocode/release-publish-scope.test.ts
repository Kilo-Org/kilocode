import { expect, test } from "bun:test"
import path from "path"

test("Kilo releases do not publish upstream-owned packages", async () => {
  const root = path.join(import.meta.dir, "../../../..")
  const src = await Bun.file(path.join(root, "script", "publish.ts")).text()

  expect(src).not.toContain("packages/ui/script/publish.ts")
  expect(src).toContain("packages/opencode/script/publish.ts")
  expect(src).toContain("packages/sdk/js/script/publish.ts")
  expect(src).toContain("packages/plugin/script/publish.ts")
})
