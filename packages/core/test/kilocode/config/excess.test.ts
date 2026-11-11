import { expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"

function diagnostics(input: unknown) {
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected normalized config")
  const found: ConfigNormalize.Diagnostic[] = []
  KiloConfigPolicy.parse(input, normalized.encoded, (diagnostic) => found.push(diagnostic))
  return found
}

test("an unrecognized top-level key reports one unsupported diagnostic", () => {
  expect(diagnostics({ shel: "zsh" })).toEqual([
    { kind: "unsupported", path: ["shel"], message: 'ignored unrecognized key "shel"' },
  ])
})

test("legacy names upstream normalization consumes stay silent", () => {
  for (const input of [
    { permission: { bash: "allow" } },
    { command: { foo: { template: "hi" } } },
    { commands: { foo: { template: "hi" } } },
    { autoupdate: false },
    { autoshare: false },
    { snapshot: false },
    { tools: { write: false } },
    { plugin: [] },
    { mcp: {} },
    { provider: { anthropic: { options: { apiKey: "x" } } } },
    { agent: { build: { model: "anthropic/x" } } },
  ]) {
    expect(diagnostics(input)).toEqual([])
  }
})

test("a canonical key and the derived workflow_models stay silent", () => {
  expect(diagnostics({ shell: "zsh", workflow_models: { foo: { providerID: "x", model: "y" } } })).toEqual([])
})

test("an invalid value of a known key still reports its own diagnostic", () => {
  expect(diagnostics({ privacy_mode: "yes" })).toEqual([
    { kind: "invalid", path: ["privacy_mode"], message: expect.stringContaining("expected a boolean") },
  ])
})

test("two unknown keys report two diagnostics", () => {
  expect(diagnostics({ shel: 1, colour: 2 })).toEqual([
    { kind: "unsupported", path: ["shel"], message: 'ignored unrecognized key "shel"' },
    { kind: "unsupported", path: ["colour"], message: 'ignored unrecognized key "colour"' },
  ])
})

test("a key the reader already refuses is not reported twice", () => {
  expect(diagnostics({ console: { diff_style: "split" } })).toEqual([
    { kind: "unsupported", path: ["console"], message: expect.stringContaining("ignored console") },
  ])
})
