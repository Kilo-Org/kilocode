import { expect, test } from "bun:test"

const transpiler = new Bun.Transpiler({ loader: "ts" })

// Cover the whole runtime graph starting at the policy, not the indexing package as a whole.
test.each([
  ["restart-policy.ts", ["./constants", "./embedding-profile", "./model-registry"]],
  ["embedding-profile.ts", ["./model-registry"]],
  ["constants/index.ts", []],
  ["model-registry.ts", []],
] as const)("%s stays independent of live indexing services", async (file, allowed: readonly string[]) => {
  const source = await Bun.file(new URL(`../../../src/indexing/${file}`, import.meta.url)).text()
  const imports = transpiler.scanImports(source)

  expect(imports.filter((entry) => entry.kind !== "import-statement" || !allowed.includes(entry.path))).toEqual([])
  // Also catch type-only manager references, runtime loading and direct I/O via host globals.
  expect(source).not.toMatch(/["'][^"']*\/config-manager(?:\.[cm]?ts)?["']/)
  expect(source).not.toMatch(/\b(?:(?:Bun|Deno|process)\s*(?:\.|\[)|(?:fetch|require|import)\s*\()/)
})
