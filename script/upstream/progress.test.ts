import { expect, test } from "bun:test"
import {
  areaOf,
  canon,
  classify,
  compare,
  featureOf,
  grid,
  importBindings,
  knownFeatures,
  parseHunks,
  parseProofs,
  patchId,
  placement,
  proofByCell,
  scanImports,
  squarify,
} from "./progress"

const split = { "session/steering": "steering", "kilo-ui": "ui", plugins: "plugin" }

test("featureOf: packages, directories, split table and loose files", () => {
  const known = knownFeatures(
    ["packages/kilo-memory/src/a.ts", "packages/opencode/src/kilocode/agent-manager/tool.ts", "packages/opencode/src/kilocode/session/steering.ts"],
    split,
  )
  expect(featureOf("packages/kilo-memory/src/a.ts", split)).toBe("memory")
  expect(featureOf("packages/kilo-gateway-core/src/device.ts", split)).toBe("gateway")
  expect(featureOf("packages/kilo-ui/src/x.tsx", split)).toBe("ui")
  expect(featureOf("packages/opencode/src/kilocode/agent-manager/tool.ts", split)).toBe("agent-manager")
  expect(featureOf("packages/opencode/src/kilocode/session/steering.ts", split)).toBe("steering")
  expect(featureOf("packages/opencode/src/kilocode/session/other.ts", split)).toBe("session")
  expect(featureOf("packages/opencode/src/kilocode/plugins/x.ts", split)).toBe("plugin")
  // loose files join the longest known feature that prefixes their name, else keep their own name
  expect(featureOf("packages/opencode/test/kilocode/agent-manager-service.test.ts", split, known)).toBe("agent-manager")
  expect(featureOf("packages/core/src/kilocode/caffeination.ts", split, known)).toBe("caffeination")
  expect(featureOf("packages/core/src/x.ts", split)).toBeUndefined()
})

test("areaOf names the upstream area of a shared file", () => {
  expect(areaOf("packages/opencode/src/session/prompt.ts")).toBe("session")
  expect(areaOf("packages/tui/src/component/x.tsx")).toBe("tui/component")
  expect(areaOf("packages/opencode/test/tool/bash.test.ts")).toBe("test")
  expect(areaOf("packages/core/package.json")).toBe("core/pkg")
})

test("canon makes a brand rename compare equal and keeps real changes apart", () => {
  expect(canon(['import { x } from "@opencode-ai/sdk"'])).toBe(canon(['import { x } from "@kilocode/sdk" // kilocode_change']))
  expect(canon(["const name = 'OpenCode'"])).toBe(canon(["const name = 'Kilo Code'"]))
  expect(canon(["const a = 1"])).not.toBe(canon(["const a = 2"]))
})

test("patchId ignores whitespace and comments and is stable", () => {
  expect(patchId(["const a = 1 // kilocode_change", "  const b = 2"])).toBe(patchId(["const a=1", "const b=2 // other note"]))
  expect(patchId(["const a = 1"])).not.toBe(patchId(["const a = 2"]))
  expect(patchId(["const a = 1"])).toMatch(/^[0-9a-f]{12}$/)
})

const diff = [
  "diff --git a/packages/opencode/src/session/prompt.ts b/packages/opencode/src/session/prompt.ts",
  "--- a/packages/opencode/src/session/prompt.ts",
  "+++ b/packages/opencode/src/session/prompt.ts",
  "@@ -10,0 +11,2 @@",
  '+import { Steering } from "@/kilocode/session/steering" // kilocode_change',
  "+const MAX = 8192 // kilocode_change",
  "@@ -40,0 +43 @@",
  "+// kilocode_change end",
  "@@ -50 +53 @@",
  '-const brand = "OpenCode"',
  '+const brand = "Kilo Code" // kilocode_change',
  "@@ -60,0 +64 @@",
  "+  Steering.apply(input)",
  "@@ -70,0 +75 @@",
  "+  const x = 1 // kilocode_change(sandbox) start - limit",
  "@@ -80,0 +86 @@",
  "+  const y = untyped()",
  "@@ -90,0 +97 @@",
  "+++x // content that starts with ++ is not a file header",
].join("\n")

test("parseHunks and classify: tag, import, identifier, branding, marker-only, unattributed", () => {
  const hunks = parseHunks(diff)
  expect(hunks).toHaveLength(7)
  expect(hunks[0].line).toBe(11)
  expect(hunks[6].added).toEqual(["++x // content that starts with ++ is not a file header"])
  const bindings = importBindings('import { Steering } from "@/kilocode/session/steering"\n// import { Old } from "@/kilocode/sandbox/old"\n', split)
  expect(bindings.get("Steering")).toBe("steering")
  expect(bindings.has("Old")).toBe(false)
  const results = hunks.map((h) => classify(h, bindings, split))
  expect(results[0]).toEqual({ kind: "cell", feature: "steering", how: "import" })
  expect(results[1]).toEqual({ kind: "marker" })
  expect(results[2]).toEqual({ kind: "branding" })
  expect(results[3]).toEqual({ kind: "cell", feature: "steering", how: "identifier" })
  expect(results[4]).toEqual({ kind: "cell", feature: "sandbox", how: "tag" })
  expect(results[5]).toEqual({ kind: "cell", feature: "unattributed:session", how: "unattributed" })
})

test("squarify fills the panel with one rectangle per value, areas proportional to the values", () => {
  const rects = squarify([6, 3, 1], 0, 0, 100, 50)
  expect(rects).toHaveLength(3)
  const areas = rects.map(([, , w, h]) => w * h)
  expect(areas.reduce((a, b) => a + b, 0)).toBeCloseTo(5000, 6)
  expect(areas[0] / areas[2]).toBeCloseTo(6, 6)
  for (const [x, y, w, h] of rects) expect(x >= 0 && y >= 0 && x + w <= 100.000001 && y + h <= 50.000001).toBe(true)
})

test("grid returns exactly count cells inside the box", () => {
  const cells = grid(7, 10, 10, 30, 20)
  expect(cells).toHaveLength(7)
  for (const [x, y, w, h] of cells) expect(x >= 10 && y >= 10 && x + w <= 40.000001 && y + h <= 30.000001).toBe(true)
  expect(grid(0, 0, 0, 10, 10)).toEqual([])
})

test("compare reports the delta per feature and the cells that closed, dropped or reopened", () => {
  const kinds = (module: number, patch: number) => ({ module: { done: module, total: 10 }, api: { done: 0, total: 0 }, patch: { done: patch, total: 5 }, test: { done: 0, total: 0 } })
  const base = {
    summary: { done: 1, total: 30, percent: 3.3, dropped: 0 },
    features: [{ feature: "gateway", done: 1, total: 15, dropped: 0, kinds: kinds(1, 0) }, { feature: "memory", done: 0, total: 15, dropped: 0, kinds: kinds(0, 0) }],
    done: ["module:a", "module:gone"],
    dropped: [],
  }
  const head = {
    summary: { done: 4, total: 30, percent: 13.3, dropped: 1 },
    features: [{ feature: "gateway", done: 4, total: 15, dropped: 1, kinds: kinds(3, 1) }, { feature: "memory", done: 0, total: 15, dropped: 0, kinds: kinds(0, 0) }],
    done: ["module:a", "module:b", "patch:gateway:0123456789ab"],
    dropped: ["patch:gateway:ffffffffffff"],
  }
  const out = compare(base, head)
  expect(out).toContain("3.3% → 13.3%")
  expect(out).toContain("| gateway | 1/15 | 4/15 | +2 modules done; +1 patch done; +1 dropped |")
  expect(out).not.toContain("| memory |")
  expect(out).toContain("2 cells closed")
  expect(out).toContain("1 cells reopened")
  expect(out).toContain("`module:gone`")
  expect(out).toContain("`patch:gateway:ffffffffffff`")
  expect(compare(head, head)).toContain("No change to the progress map.")
  expect(compare({}, head)).toContain("0% → 13.3%")
})

const rungs = { "packages/core/src/session/compaction.ts": { rung: 3 as const }, "packages/core/src/sse.ts": { rung: 4 as const } }

test("parseProofs: kilo_port in Kilo-owned files, kilocode_change in shared files, each with its landed rung", () => {
  const grep = [
    "packages/kilo-plugin/src/sandbox-guard.ts:12:kilo_port(sandbox:1a2b3c4d5e6f)",
    "packages/kilo-cli/src/index.ts:40:kilo_port(cli:0123456789ab)",
    "packages/core/src/kilocode/gateway.ts:7:kilo_port(gateway:aaaaaaaaaaaa)",
    "packages/core/src/session/compaction.ts:88:kilocode_change(compaction-policy:bbbbbbbbbbbb)",
    "packages/core/src/sse.ts:5:kilocode_change(process:cccccccccccc)",
    "packages/core/src/unlisted.ts:1:kilocode_change(process:dddddddddddd)",
    "packages/core/src/tool/grep.ts:3:kilo_port(tool:eeeeeeeeeeee)",
    "packages/kilo-plugin/src/x.ts:9:kilocode_change(tool:ffffffffffff)",
    "packages/kilo-plugin/src/y.ts:1:kilo_port(tool:not-an-id)",
  ].join("\n")
  expect(parseProofs(grep, rungs).map((p) => [p.id, p.at, p.rung, p.misplaced])).toEqual([
    ["patch:sandbox:1a2b3c4d5e6f", "packages/kilo-plugin/src/sandbox-guard.ts:12", 1, false],
    ["patch:cli:0123456789ab", "packages/kilo-cli/src/index.ts:40", 2, false],
    ["patch:gateway:aaaaaaaaaaaa", "packages/core/src/kilocode/gateway.ts:7", 1, false],
    ["patch:compaction-policy:bbbbbbbbbbbb", "packages/core/src/session/compaction.ts:88", 3, false],
    ["patch:process:cccccccccccc", "packages/core/src/sse.ts:5", 4, false],
    // a shared file without a shared-patches.json entry counts as rung 4
    ["patch:process:dddddddddddd", "packages/core/src/unlisted.ts:1", 4, false],
    ["patch:tool:eeeeeeeeeeee", "packages/core/src/tool/grep.ts:3", 4, true],
    ["patch:tool:ffffffffffff", "packages/kilo-plugin/src/x.ts:9", 1, true],
  ])
})

test("proofByCell reports a cell proved by a kilo_port and a marker once, at the highest rung", () => {
  const proofs = parseProofs(
    [
      "packages/core/src/session/compaction.ts:88:kilocode_change(compaction-policy:bbbbbbbbbbbb)",
      "packages/kilo-plugin/src/compaction.ts:3:kilo_port(compaction-policy:bbbbbbbbbbbb)",
      "packages/kilo-plugin/src/a.ts:1:kilo_port(sandbox:1a2b3c4d5e6f)",
      "packages/kilo-plugin/src/b.ts:1:kilo_port(sandbox:1a2b3c4d5e6f)",
    ].join("\n"),
    rungs,
  )
  const best = proofByCell(proofs)
  expect([...best.keys()]).toEqual(["patch:compaction-policy:bbbbbbbbbbbb", "patch:sandbox:1a2b3c4d5e6f"])
  expect(best.get("patch:compaction-policy:bbbbbbbbbbbb")?.rung).toBe(3)
  expect(best.get("patch:sandbox:1a2b3c4d5e6f")?.at).toBe("packages/kilo-plugin/src/a.ts:1")
})

test("scanImports counts distinct core-internal modules and enforces the logic-package rule", () => {
  const out = scanImports([
    ["packages/core/src/kilocode/gateway.ts", 'import { Bus } from "../bus.js"\nimport { Variant } from "../variant.js"\nimport { Rpc } from "./gateway-rpc.js"\nimport { define } from "@opencode/plugin/effect/plugin"\n'],
    ["packages/tui/src/kilocode/gateway.tsx", 'import { Rpc } from "@opencode/core/kilocode/gateway-rpc"\nimport { useTheme } from "../context/theme"\nexport { Bus } from "@opencode/core/bus"\n'],
    ["packages/kilo-plugin/src/index.ts", 'const { Session } = await import("@opencode/core/session/index.ts")\n// import { Old } from "@opencode/core/old"\n'],
    ["packages/kilo-gateway-core/src/http.ts", 'import { Effect } from "effect"\nimport type { Model } from "@opencode/schema/model"\nimport { x } from "./x"\n'],
  ])
  expect(out.modules).toEqual(["@opencode/core/bus", "@opencode/core/session", "@opencode/core/variant"])
  expect(out.violations).toEqual(["packages/kilo-gateway-core/src/http.ts: @opencode/schema/model"])
})

test("placement counts new marked lines in shared files by rung and new kilo_port annotations", () => {
  const diff = [
    "diff --git a/packages/core/src/session/compaction.ts b/packages/core/src/session/compaction.ts",
    "@@ -1,0 +2,3 @@",
    "+  // kilocode_change start",
    "+  const toolOutput = input.toolOutput",
    "+  // kilocode_change end",
    "@@ -2 +5 @@",
    "-  const max = 1250",
    "+  const max = toolOutput ?? 1250 // kilocode_change(compaction-policy) seam",
    "diff --git a/packages/core/src/sse.ts b/packages/core/src/sse.ts",
    "@@ -2,0 +3 @@",
    "+const b = 2",
    "@@ -3,0 +5 @@",
    "+unmarked()",
    "diff --git a/packages/core/src/added.ts b/packages/core/src/added.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/packages/core/src/added.ts",
    "@@ -0,0 +1,2 @@",
    "+// kilocode_change - new file",
    "+export const added = 1",
    "diff --git a/packages/kilo-plugin/src/guard.ts b/packages/kilo-plugin/src/guard.ts",
    "@@ -0,0 +1,2 @@",
    "+// kilo_port(sandbox:1a2b3c4d5e6f)",
    "+export const guard = 1 // kilocode_change",
    "diff --git a/script/upstream/x.test.ts b/script/upstream/x.test.ts",
    "@@ -0,0 +1 @@",
    "+const s = 'kilo_port(sandbox:1a2b3c4d5e6f)'",
  ].join("\n")
  const contents = new Map([
    [
      "packages/core/src/session/compaction.ts",
      ["export function configure(input) {", "  // kilocode_change start", "  const toolOutput = input.toolOutput", "  // kilocode_change end", "  const max = toolOutput ?? 1250 // kilocode_change(compaction-policy) seam", "}"].join("\n"),
    ],
    // the added line 3 sits inside a block that was already there; line 5 has no marker
    ["packages/core/src/sse.ts", ["// kilocode_change start", "const a = 1", "const b = 2", "// kilocode_change end", "unmarked()"].join("\n")],
    ["packages/core/src/added.ts", "// kilocode_change - new file\nexport const added = 1\n"],
  ])
  const place = placement(diff, contents, rungs)
  expect(place).toEqual({ marked: { plugin: 0, host: 0, seam: 4, patch: 3 }, ports: 1 })

  const summary = (coreImports: number) => ({ done: 0, total: 1, percent: 0, dropped: 0, coreImports, sharedPatches: { seam: 13, patch: 1 } })
  const head = { summary: summary(2), coreImports: ["@opencode/core/bus", "@opencode/core/variant"] }
  const out = compare({ summary: summary(1), coreImports: ["@opencode/core/variant"] }, head, place)
  expect(out).toContain("**Placement:** 7 new marked lines in shared files (4 seam, 3 patch), 1 new `kilo_port` annotation, 1 new core-internal import (`@opencode/core/bus`).")
  expect(out).toContain("**Ratchets:** 2 core-internal imports (base 1); shared patches by rung 13 seam, 1 patch (base 13 seam, 1 patch).")
  expect(compare({}, head, { marked: { plugin: 0, host: 0, seam: 0, patch: 0 }, ports: 0 })).toContain(
    "**Placement:** 0 new marked lines in shared files, 0 new `kilo_port` annotations, core-internal imports not compared (the base map has no import list).",
  )
})
