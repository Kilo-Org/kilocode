import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import path from "node:path"

// @anthropic-ai/sandbox-runtime pins zod 3, which has no patched release. The root
// package.json installs zod 4 for it and patches/ points its import at zod 4's bundled
// v3 API (`zod/v3`). If the patch stops applying, its config schema module fails here.
describe("sandbox-runtime on zod/v3", () => {
  test("loads its config schemas with zod 4", async () => {
    const entry = Bun.resolveSync("@anthropic-ai/sandbox-runtime", import.meta.dir)
    const root = path.resolve(path.dirname(entry), "..")
    const req = createRequire(path.join(root, "package.json"))
    expect(Number(req("zod/package.json").version.split(".")[0])).toBeGreaterThanOrEqual(4)

    const mod = await import(path.join(root, "dist/sandbox/sandbox-config.js"))
    const schemas = Object.values(mod).filter(
      (value): value is { safeParse: (input: unknown) => { success: boolean } } =>
        typeof (value as { safeParse?: unknown })?.safeParse === "function",
    )
    expect(schemas.length).toBeGreaterThan(0)
    for (const schema of schemas) expect(schema.safeParse(42).success).toBe(false)
  })
})
