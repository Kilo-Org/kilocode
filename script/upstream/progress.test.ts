import { expect, test } from "bun:test"
import { areaOf, canon, classify, featureOf, hookId, importBindings, knownFeatures, parseHunks } from "./progress"

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

test("hookId ignores whitespace and comments and is stable", () => {
  expect(hookId(["const a = 1 // kilocode_change", "  const b = 2"])).toBe(hookId(["const a=1", "const b=2 // other note"]))
  expect(hookId(["const a = 1"])).not.toBe(hookId(["const a = 2"]))
  expect(hookId(["const a = 1"])).toMatch(/^[0-9a-f]{12}$/)
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
