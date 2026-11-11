import { expect, test } from "bun:test"
import { KiloBrandingAudit } from "../script/branding-audit"

test("flags user-visible OpenCode in a file that is not intercepted", () => {
  const findings = KiloBrandingAudit.auditFile(
    "cli/src/not-intercepted.ts",
    'export const hint = "Run opencode or restart OpenCode"',
  )
  expect(findings).toHaveLength(1)
  expect(findings[0]!.kind).toBe("missing-interception")
})

test("does not flag code that only looks like branding", () => {
  // @opencode imports, dotted IDs, the bare executable anchor, equality operands
  // and replace patterns are not user-visible branding.
  const source = [
    'import { x } from "@opencode/core/x"',
    'const id = "opencode.app.exit"',
    'const name = "opencode"',
    'const marker = line === "# opencode"',
    'const page = html.replaceAll("OpenCode", () => brand)',
  ].join("\n")
  expect(KiloBrandingAudit.auditFile("cli/src/not-intercepted.ts", source)).toEqual([])
})

test("surfaces a parse failure instead of skipping the file", () => {
  // run() turns this throw into a hard-failing `unparseable` entry rather than a
  // silent skip, so an unreadable user-facing file cannot pass the audit.
  expect(() => KiloBrandingAudit.auditFile("cli/src/broken.ts", "const = ")).toThrow()
})

test("does not flag an intercepted file whose OpenCode text the rules fully brand", () => {
  // tui/src/attention.ts is intercepted; the engine brands its user-visible text,
  // so the audit reports no rule gap.
  const findings = KiloBrandingAudit.auditFile("tui/src/attention.ts", 'const title = "OpenCode"')
  expect(findings).toEqual([])
})

test("flags a new tools.opencode reference in an intercepted tool module", async () => {
  // The structural count for `tools.opencode.session_move` stays 1, so only the
  // audit notices a newly added model-facing reference.
  const key = "core/src/tool/plugin/opencode.ts"
  const source = await Bun.file(new URL(`../../${key}`, import.meta.url)).text()
  expect(KiloBrandingAudit.auditNamespace(key, source)).toEqual([])
  const drifted = source.replace(
    "`tools.opencode.session_move`",
    "`tools.opencode.session_move`, then `tools.opencode.session_rename`",
  )
  const findings = KiloBrandingAudit.auditNamespace(key, drifted)
  expect(findings.map((f) => f.kind)).toEqual(["namespace-leak"])
  expect(findings[0]!.snippet).toContain("tools.opencode.session_rename")
})

test("flags a new built-in tool module that is not intercepted", () => {
  const findings = KiloBrandingAudit.auditNamespace(
    "core/src/tool/plugin/new.ts",
    'export const tool = { options: { namespace: "opencode", codemode: true } }',
  )
  expect(findings.map((f) => f.kind)).toEqual(["namespace-leak"])
})

test("flags a tools.opencode reference in a bundled text asset", () => {
  // Prompts and skills are bundled as strings and never parsed, so the check reads them raw.
  const findings = KiloBrandingAudit.auditNamespace(
    "kilo-plugin/src/skill/new.txt",
    'Call `tools.opencode.*`; find them with `search({ namespace: "opencode" })`.',
  )
  expect(findings.map((f) => f.kind)).toEqual(["namespace-leak", "namespace-leak"])
})

test("baseline is clean: no unexpected unbranded OpenCode on the audited surface", async () => {
  const { unexpected, stale, unparseable } = await KiloBrandingAudit.run()
  expect(unexpected.map((f) => `${f.file}:${f.line} ${f.snippet}`)).toEqual([])
  // A file the audit cannot parse is left unchecked, so it must fail, not skip.
  expect(unparseable.map((u) => `${u.file}: ${u.error}`)).toEqual([])
  // A stale allowlist entry (file with no findings) should be removed, not left to rot.
  expect(stale).toEqual([])
}, 120_000)
