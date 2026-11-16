import { expect, test } from "bun:test"
import { KiloBrandingAudit } from "../script/branding-audit"
import { allow } from "../script/branding-audit-allow"
import { coreText, serverText } from "./fixtures/branding-run"

const text = [...serverText, ...coreText]
const read = (file: string) => Bun.file(new URL(`../../${file}`, import.meta.url)).text()

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

test("flags a prompt template that names OpenCode and is not intercepted", () => {
  const findings = KiloBrandingAudit.auditFile(
    "core/src/plugin/system-prompt/new.txt",
    "You are OpenCode, a coding agent. Run `opencode run` to start.",
  )
  expect(findings.map((f) => f.kind)).toEqual(["missing-interception"])
})

test("flags the opencode namespace named in prose in a non-intercepted asset", () => {
  // Pattern coverage only: the intercepted schedule prompt is pinned by its branded output in branding.test.ts.
  const findings = KiloBrandingAudit.auditNamespace(
    "kilo-plugin/src/command/new.txt",
    "Use the schedule tools in the `opencode` namespace.",
  )
  expect(findings.map((f) => f.kind)).toEqual(["namespace-leak"])
})

test("audits packages/server/src and the modules of packages/core/src", async () => {
  const surface = await KiloBrandingAudit.surface()
  for (const [file] of text) expect(surface).toContain(`packages/${file}`)
  // Core modules outside the OAuth pages and the prompt templates, intercepted or not.
  for (const file of [
    "core/src/tool/plugin/webfetch.ts",
    "core/src/session/to-session-error.ts",
    "core/src/plugin/provider/openrouter.ts",
    "core/src/voice.ts",
  ])
    expect(surface).toContain(`packages/${file}`)
  // Kilo-owned core modules are written as Kilo text, and tests are not shipped.
  expect(surface.filter((file) => file.includes("/kilocode/") || file.endsWith(".test.ts"))).toEqual([])
  // Every allowlist entry names a file the audit reads, except the bundled skill the tool-namespace scope covers.
  for (const file of allow.keys())
    if (file !== "core/src/plugin/skill/opencode.md") expect(surface).toContain(`packages/${file}`)
})

test("flags each branded server and core module when it is not intercepted", async () => {
  // The real source under a key the loader does not intercept: what the audit reports when a module drops out of
  // KiloBranding.files, or when upstream moves it.
  for (const file of new Set(text.map(([file]) => file))) {
    const source = await read(file)
    expect(KiloBrandingAudit.auditFile(file, source), file).toEqual([])
    const findings = KiloBrandingAudit.auditFile(file.replace(".ts", ".moved.ts"), source)
    expect(
      findings.map((f) => f.kind),
      file,
    ).toEqual(text.filter(([name]) => name === file).map(() => "missing-interception" as const))
    expect(
      findings.map((f) => f.line),
      file,
    ).toEqual(
      text
        .filter(([name]) => name === file)
        .map(([, upstream]) => source.slice(0, source.indexOf(upstream)).split("\n").length),
    )
  }
})

test("an identity snippet accounts for that identity and for nothing else in its file", async () => {
  // Upstream SaaS names in user-facing errors: the names are reviewed, the rest of the module is product text.
  const errors = "core/src/session/to-session-error.ts"
  const source = await read(errors)
  expect(KiloBrandingAudit.auditFile(errors, source).length).toBeGreaterThan(0)
  expect(KiloBrandingAudit.check(errors, source)).toMatchObject({ unexpected: [], stale: [] })
  // New product text in another string of the module.
  const added = KiloBrandingAudit.check(
    errors,
    source.replace("Model use is paused until the limit resets.", "Restart OpenCode after the limit resets."),
  )
  expect(added.unexpected.map((f) => f.snippet)).toEqual([
    "Workspace usage limit reached. Restart OpenCode after the limit resets.",
  ])
  // New product text in the same string as a reviewed name.
  const mixed = KiloBrandingAudit.check(
    errors,
    source.replace("subscribe to OpenCode Go to keep going", "subscribe to OpenCode Go to keep going in OpenCode"),
  )
  expect(mixed.unexpected.map((f) => f.kind)).toEqual(["missing-interception"])

  // A wire identity pinned with the code around it: another URL of the same domain in that module is not covered.
  const provider = "core/src/plugin/provider/openrouter.ts"
  const plugin = await read(provider)
  expect(KiloBrandingAudit.check(provider, plugin)).toMatchObject({ unexpected: [], stale: [] })
  const docs = KiloBrandingAudit.check(
    provider,
    plugin.replace('"X-Title": "opencode"', '"X-Title": "opencode", "X-Docs": "https://opencode.ai/docs"'),
  )
  expect(docs.unexpected.map((f) => f.snippet)).toEqual(["https://opencode.ai/docs"])
})

test("reports an identity snippet that no longer accounts for a finding", async () => {
  const provider = "core/src/plugin/provider/openrouter.ts"
  const source = await read(provider)
  const snippet = '"HTTP-Referer": "https://opencode.ai/"'
  // Upstream changed the value: the entry is stale, and the new value is what the module sends now.
  expect(
    KiloBrandingAudit.check(provider, source.replaceAll(snippet, '"HTTP-Referer": "https://example.com/"')),
  ).toEqual({ findings: [], unexpected: [], stale: [snippet] })
  // Upstream reworded the code the snippet pins: the identity is a finding again until a person reviews it.
  const moved = KiloBrandingAudit.check(provider, source.replaceAll(snippet, 'Referer: "https://opencode.ai/"'))
  expect(moved.unexpected.map((f) => f.snippet)).toEqual(["https://opencode.ai/"])
  expect(moved.stale).toEqual([snippet])
  // An entry for a name the module does not hold.
  const entry = [
    [snippet, "reviewed"],
    ["OpenCode Zen", "not in this module"],
  ] as const
  expect(KiloBrandingAudit.check(provider, source, entry).stale).toEqual(["OpenCode Zen"])
})

test("does not count a trace span name as user-visible text", async () => {
  // Effect.fn("OpenCodeTools.Plugin") names a span in an intercepted module. The name is an identity, so the engine
  // does not offer it to the rules; the same token in a string a person reads is still a rule gap.
  const key = "core/src/tool/plugin/opencode.ts"
  const source = await read(key)
  expect(source).toContain('Effect.fn("OpenCodeTools.Plugin")')
  expect(KiloBrandingAudit.auditFile(key, source)).toEqual([])
  const findings = KiloBrandingAudit.auditFile(key, 'export const label = "OpenCodeTools.Plugin"')
  expect(findings.map((f) => f.kind)).toEqual(["rule-gap"])
})

test("does not flag the server's wire identities", async () => {
  // The basic-auth username, the session cookie, the request headers and the MCP client name are identities that
  // clients and servers match on, not product text.
  for (const [file, identity] of [
    ["server/src/auth.ts", 'username: "opencode"'],
    ["server/src/auth.ts", "opencode_session"],
    ["server/src/location.ts", "x-opencode-directory"],
    ["server/src/media-uri.ts", "x-opencode-capabilities"],
    ["server/src/routes.ts", 'name: "opencode"'],
  ] as const) {
    const source = await read(file)
    expect(source, file).toContain(identity)
    expect(KiloBrandingAudit.auditFile(file, source), file).toEqual([])
  }
})

test("baseline is clean: no unexpected unbranded OpenCode on the audited surface", async () => {
  const { unexpected, stale, unparseable } = await KiloBrandingAudit.run()
  expect(unexpected.map((f) => `${f.file}:${f.line} ${f.snippet}`)).toEqual([])
  // A file the audit cannot parse is left unchecked, so it must fail, not skip.
  expect(unparseable.map((u) => `${u.file}: ${u.error}`)).toEqual([])
  // A stale allowlist entry (a file with no findings, a snippet that accounts for none) should be removed, not left
  // to rot.
  expect(stale).toEqual([])
}, 120_000)
