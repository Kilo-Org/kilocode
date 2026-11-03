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

test("does not flag an intercepted file whose OpenCode text the rules fully brand", () => {
  // tui/src/attention.ts is intercepted; the engine brands its user-visible text,
  // so the audit reports no rule gap.
  const findings = KiloBrandingAudit.auditFile("tui/src/attention.ts", 'const title = "OpenCode"')
  expect(findings).toEqual([])
})

test("baseline is clean: no unexpected unbranded OpenCode on the audited surface", async () => {
  const { unexpected, stale } = await KiloBrandingAudit.run()
  expect(unexpected.map((f) => `${f.file}:${f.line} ${f.snippet}`)).toEqual([])
  // A stale allowlist entry (file with no findings) should be removed, not left to rot.
  expect(stale).toEqual([])
}, 120_000)
