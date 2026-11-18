import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"

const SRC = path.join(import.meta.dir, "../../../src")
const POLICY = path.join(SRC, "indexing/restart-policy.ts")
const transpiler = new Bun.Transpiler({ loader: "ts" })
const LIVE = /config-manager|\/manager(?:\.ts)?$/
const HOST_ACCESS = /\b(?:(?:Bun|Deno|process)\s*(?:\.|\[)|(?:fetch|require|import)\s*\()/

// Walk the runtime graph from the policy entry so every hop is scanned, including a helper added later.
test("the restart policy graph has no live clients, host I/O, or config manager", async () => {
  const graph = await runtimeGraph(POLICY)
  const findings = graph.edges.flatMap(({ from, specifier, target }) =>
    target && !LIVE.test(target) ? [] : [`${relative(from)} imports ${specifier}`],
  )
  const hostAccess = [...graph.sources]
    .filter(([, text]) => HOST_ACCESS.test(text) || /["'][^"']*config-manager[^"']*["']/.test(text))
    .map(([file]) => `${relative(file)} uses host access or the config manager`)
  expect([...findings, ...hostAccess]).toEqual([])

  // Keep the decision small: a new runtime dependency needs a deliberate review of this list.
  expect([...graph.sources.keys()].map(relative).sort()).toEqual([
    "indexing/constants/index.ts",
    "indexing/embedding-profile.ts",
    "indexing/model-registry.ts",
    "indexing/restart-policy.ts",
  ])
})

async function runtimeGraph(entry: string) {
  const sources = new Map<string, string>()
  const edges: { from: string; specifier: string; target?: string }[] = []
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()!
    if (sources.has(file)) continue
    const text = await Bun.file(file).text()
    sources.set(file, text)
    for (const imported of transpiler.scanImports(text)) {
      // A dynamic import or require could still load a client, a filesystem module or the config manager.
      const target = imported.kind === "import-statement" ? resolve(file, imported.path) : undefined
      edges.push({ from: file, specifier: imported.path, target })
      if (target) pending.push(target)
    }
  }
  return { sources, edges }
}

function resolve(file: string, specifier: string) {
  if (!specifier.startsWith(".")) return undefined
  const base = path.resolve(path.dirname(file), specifier).replace(/\.js$/, "")
  return [`${base}.ts`, path.join(base, "index.ts")]
    .filter((candidate) => candidate.startsWith(SRC + path.sep) && existsSync(candidate))
    .at(0)
}

function relative(file: string) {
  return path.relative(SRC, file).replaceAll(path.sep, "/")
}
