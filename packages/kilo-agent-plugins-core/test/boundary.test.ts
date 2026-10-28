import { expect, test } from "bun:test"
import path from "node:path"

// The loader stays independent of OpenCode so the v2 adapter, the marketplace and other clients can share it.
test("has no OpenCode imports or dependencies", async () => {
  const root = path.join(import.meta.dir, "..")
  const files = await Array.fromAsync(new Bun.Glob("src/**/*.ts").scan({ cwd: root }))
  expect(files.length).toBeGreaterThan(0)
  const offenders = await Promise.all(
    files.map(async (file) =>
      (await Bun.file(path.join(root, file)).text()).includes("@opencode") ? file : undefined,
    ),
  )
  expect(offenders.filter(Boolean)).toEqual([])
  const pkg = await Bun.file(path.join(root, "package.json")).json()
  expect(
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith("@opencode")),
  ).toEqual([])
})
