import { expect, test } from "bun:test"
import path from "node:path"
import type { ImportReport, Placement } from "./placement"
import { repo } from "./utils/testing"

const script = path.join(import.meta.dir, "placement.ts")
const root = path.resolve(import.meta.dir, "../..")

async function run(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  return { code: await proc.exited, stdout, stderr: await new Response(proc.stderr).text() }
}

// The real tree, so the expected answers stay true for the current upstream release.
async function place(target: string): Promise<Placement> {
  const result = await run(root, target, "--json")
  expect(result.code).toBe(0)
  return JSON.parse(result.stdout)
}

test("compaction: session hook, upstream plugin that transforms the service, location node", async () => {
  const report = await place("packages/core/src/session/compaction.ts")
  expect(report.kiloOwned).toBe(false)
  expect(report.domains.find((item) => item.domain === "session")?.matches).toContain("hook compaction")
  const plugin = report.plugins.find((item) => item.id === "opencode.config.compaction")
  expect(plugin?.use).toBe("transform")
  expect(plugin?.services).toContain("SessionCompaction.Service")
  expect(plugin?.calls).toEqual(expect.arrayContaining(["compaction.transform", "editor.configure"]))
  expect(report.nodes.map((item) => [item.name, item.kind])).toEqual([["SessionCompaction.node", "location"]])
  expect(report.seams.entry).toBeNull()
  expect(report.suggestion.rung).toBe(1)
})

test("grep: the file is the tool plugin, with tool hooks and editor and no node", async () => {
  const report = await place("packages/core/src/tool/plugin/grep.ts")
  expect(report.plugins.find((item) => item.use === "self")?.id).toBe("opencode.tool.grep")
  const tool = report.domains.find((item) => item.domain === "tool")
  expect(tool?.hooks).toEqual(expect.arrayContaining(["execute.before", "execute.after"]))
  expect(tool?.editor).toEqual(expect.arrayContaining(["add", "update", "remove"]))
  expect(report.tool?.wrap).toContain('ToolEditor.update("grep"')
  expect(report.nodes).toEqual([])
  expect(report.seams.entry).toBeNull()
})

test("global (as a module specifier): no plugin hook, a global node that the host replaces", async () => {
  const report = await place("@opencode/util/global")
  expect(report.path).toBe("packages/util/src/global.ts")
  expect(report.domains).toEqual([])
  expect(report.nodes.map((item) => [item.name, item.kind, item.host])).toEqual([
    ["Global.node", "global", "Global.node.replace(Global.layerWith(...))"],
  ])
  expect(report.suggestion.rung).toBe(2)
  expect((await run(root, "packages/util/src/global.ts")).stdout).toContain("| Global.node | global | ")
})

test("a Kilo-owned path, and a path that does not exist", async () => {
  expect((await place("script/upstream/placement.ts")).kiloOwned).toBe(true)
  const missing = await run(root, "packages/core/src/missing-module.ts")
  expect(missing.code).toBe(1)
  expect(missing.stderr).toContain("File not found: packages/core/src/missing-module.ts")
})

test("--imports: logic packages fail on @opencode imports, adapters count core-internal modules", async () => {
  await using r = await repo()
  await r.write("packages/core/src/bus.ts", "export const bus = 1\n")
  const pin = await r.commit("upstream")
  await r.write("packages/core/src/kilocode/rpc.ts", "export const rpc = 1\n")
  await r.write("packages/core/src/kilocode/x.ts", 'import { bus } from "../bus.js"\nimport { rpc } from "./rpc.js"\n')
  await r.write("packages/kilo-plugin/src/index.ts", 'export { rpc } from "@opencode/core/kilocode/rpc"\n')
  await r.write("packages/kilo-demo-core/src/index.ts", "export const ok = 1\n")

  const ok = await run(r.dir, "--imports", "--json", "--pin", pin)
  expect(ok.code).toBe(0)
  const report: ImportReport = JSON.parse(ok.stdout)
  expect(report.adapters).toEqual([
    { adapter: "packages/core/src/kilocode", files: 2, modules: ["bus"] },
    { adapter: "packages/kilo-plugin/src", files: 1, modules: [] },
  ])

  await r.write(
    "packages/kilo-demo-core/src/index.ts",
    'export { bus } from "@opencode/core/bus"\nexport const load = () => import("@opencode/util/global")\n',
  )
  const failed = await run(r.dir, "--imports", "--pin", pin)
  expect(failed.code).toBe(1)
  expect(failed.stdout).toContain("packages/kilo-demo-core/src/index.ts:1: @opencode/core/bus")
  expect(failed.stdout).toContain("packages/kilo-demo-core/src/index.ts:2: @opencode/util/global")
})
