import { describe, expect, test } from "bun:test"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")

describe("typecheck entry points", () => {
  test("CI runs the same extension check as release packaging", async () => {
    const pkg = await Bun.file(path.join(root, "package.json")).json()
    const source = await Bun.file(path.join(root, "script/build.ts")).text()

    expect(pkg.scripts["check-types"]).toBe("tsc --noEmit")
    expect(pkg.scripts.typecheck.split(" && ")[0]).toBe("bun run check-types")
    expect(source).toContain("await $`bun run check-types`")
  })
})
