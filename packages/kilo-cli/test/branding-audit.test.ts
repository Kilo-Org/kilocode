import { expect, test } from "bun:test"
import { KiloBrandingAudit } from "../script/branding-audit"
import { allow } from "../script/branding-audit-allow"
import { KiloBranding } from "../src/branding/text"
import { branded } from "./fixtures/branding-run"

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

test("audits the server, core and plugin packages, and Kilo's own plugins", async () => {
  const surface = await KiloBrandingAudit.surface()
  for (const { file } of branded) expect(surface).toContain(`packages/${file}`)
  // A module the loader does not intercept: the scope is the whole package, not the three branded modules.
  expect(surface).toContain("packages/server/src/auth.ts")
  // Core modules outside the OAuth pages and the prompt templates, the plugin package, and Kilo-owned plugin text.
  for (const file of [
    "core/src/tool/plugin/webfetch.ts",
    "core/src/session/to-session-error.ts",
    "core/src/plugin/provider/openrouter.ts",
    "core/src/voice.ts",
    "plugin/src/gui/vite.ts",
    "kilo-plugin/src/flow/permissions.ts",
    "kilo-plugin/src/skill/kilo-config.txt",
  ])
    expect(surface).toContain(`packages/${file}`)
  // Kilo-owned core modules are written as Kilo text, and tests are not shipped.
  expect(surface.filter((file) => file.includes("/kilocode/") || file.endsWith(".test.ts"))).toEqual([])
  // Every allowlist entry names a file the audit reads, except the bundled skill the tool-namespace scope covers.
  for (const file of allow.keys())
    if (file !== "core/src/plugin/skill/opencode.md") expect(surface).toContain(`packages/${file}`)
})

test("flags each branded server, core and plugin module when it is not intercepted", async () => {
  // The real source under a key the loader does not intercept: what the audit reports when a module drops out of
  // KiloBranding.files, or when upstream moves it.
  for (const { file, texts } of branded) {
    const source = await read(file)
    expect(KiloBrandingAudit.auditFile(file, source), file).toEqual([])
    const findings = KiloBrandingAudit.auditFile(file.replace(".ts", ".moved.ts"), source)
    expect(
      findings.map((f) => f.kind),
      file,
    ).toEqual(texts.map(() => "missing-interception" as const))
    expect(
      findings.map((f) => f.line),
      file,
    ).toEqual(texts.map(([, upstream]) => source.slice(0, source.indexOf(upstream)).split("\n").length))
  }
})

test("flags an upstream name left in Kilo-owned plugin text", async () => {
  // No loader rewrites Kilo's own plugins, so the audit reads them as written. The `opencode` tool namespace named in
  // prose is the case the namespace patterns cannot see: it is one bare word.
  const file = "kilo-plugin/src/flow/permissions.ts"
  const source = await read(file)
  expect(source).toContain("write, patch, and kilo use the edit action")
  expect(KiloBrandingAudit.check(file, source)).toMatchObject({ unexpected: [], stale: [] })
  const drifted = source.replace("and kilo use", "and opencode use")
  expect(KiloBrandingAudit.auditNamespace(file, drifted)).toEqual([])
  expect(KiloBrandingAudit.check(file, drifted).unexpected.map((f) => f.kind)).toEqual(["missing-interception"])
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
  ).toEqual({ findings: [], unexpected: [], stale: [snippet], bare: [] })
  // Upstream reworded the code the snippet pins: the identity is a finding again until a person reviews it.
  const moved = KiloBrandingAudit.check(provider, source.replaceAll(snippet, 'Referer: "https://opencode.ai/"'))
  expect(moved.unexpected.map((f) => f.snippet)).toEqual(["https://opencode.ai/"])
  expect(moved.stale).toEqual([snippet])
  // An entry for a name the module does not hold.
  const entries = new Map([
    [
      provider,
      [
        [snippet, "reviewed"],
        ["OpenCode Zen", "not in this module"],
      ] as const,
    ],
  ])
  expect(KiloBrandingAudit.check(provider, source, entries).stale).toEqual(["OpenCode Zen"])
  // Without an entry, every finding is unexpected.
  expect(KiloBrandingAudit.check(provider, source, new Map()).unexpected.map((f) => f.snippet)).toEqual([
    "https://opencode.ai/",
  ])
})

test("rejects an identity snippet that is only the product name", async () => {
  // `OpenCode` alone would account for every later use of the name in the file, product text included.
  const file = "core/src/plugin/provider/nvidia.ts"
  const source = await read(file)
  const check = (...snippets: string[]) =>
    KiloBrandingAudit.check(file, source, new Map([[file, snippets.map((snippet) => [snippet, "reviewed"] as const)]]))
      .bare
  expect(check("OpenCode", '"OpenCode"', "opencode", " OpenCode's ", "OpenCode.")).toEqual([
    "OpenCode",
    '"OpenCode"',
    "opencode",
    " OpenCode's ",
    "OpenCode.",
  ])
  // A longer name, or the code around the string, says which use is meant.
  expect(
    check("OpenCode Go", "OpenCode Console", 'const agentName = "OpenCode"', '"HTTP-Referer": "https://opencode.ai/"'),
  ).toEqual([])
  expect(KiloBrandingAudit.check(file, source).bare).toEqual([])
})

test("the command fails on a stale entry and on a bare snippet", async () => {
  const file = "core/src/usage-limits.ts"
  const reviewed = allow.get(file)
  if (typeof reviewed !== "object") throw new Error(`${file} is not allowlisted by snippet`)
  expect(await KiloBrandingAudit.main(new Map([...allow, [file, [...reviewed, ["OpenCode Zen", "gone"]]]]))).toEqual({
    code: 1,
    lines: [`branding-audit: stale allowlist entry (accounts for no finding): packages/${file}: "OpenCode Zen"`],
  })
  const wide = await KiloBrandingAudit.main(new Map([...allow, [file, [["OpenCode", "too wide"]]]]))
  expect(wide).toEqual({
    code: 1,
    lines: [
      `branding-audit: allowlist snippet is only the product name and would hide every later use of it: packages/${file}: "OpenCode"`,
    ],
  })
}, 120_000)

test("the command says where a finding is and how to fix it", async () => {
  // Without its entry, the referer of a provider plugin is a finding again.
  const file = "core/src/plugin/provider/openrouter.ts"
  const result = await KiloBrandingAudit.main(new Map([...allow].filter(([key]) => key !== file)))
  expect(result.code).toBe(1)
  expect(result.lines.slice(0, 2)).toEqual([
    "\nbranding-audit: 1 unbranded user-visible OpenCode occurrence(s):\n",
    `  [missing-interception] packages/${file}:12:78  "https://opencode.ai/"`,
  ])
  // Where each kind of text is fixed: Kilo-owned source, the loader's list, or a reviewed snippet.
  const advice = result.lines.at(-1)
  expect(advice).toContain("In a Kilo-owned file (packages/kilo-*), correct the text in its source.")
  expect(advice).toContain("In an upstream file, add the file to KiloBranding.files")
  expect(advice).toContain("an exact snippet with its reason")
  expect(result.lines).toHaveLength(3)
}, 120_000)

test("reports product text in a text asset at its own line", async () => {
  // A prompt file is one span. The finding points at the product name, not at the first line of the file.
  const prompt = [
    "# Guide",
    "",
    "This guide covers configuration, commands, agents, skills and permissions in detail.",
    "After changing a provider, restart OpenCode so that the change applies.",
    "",
  ].join("\n")
  expect(KiloBrandingAudit.auditFile("kilo-plugin/src/skill/example.txt", prompt)).toEqual([
    {
      file: "kilo-plugin/src/skill/example.txt",
      line: 4,
      column: 36,
      kind: "missing-interception",
      snippet: "changing a provider, restart OpenCode so that the change applies.",
    },
  ])
  // The same in a real Kilo-owned prompt, next to the upstream names its allowlist entry keeps.
  const file = "kilo-plugin/src/skill/kilo-config.txt"
  const source = await read(file)
  const added = source.replace(
    "Use only the `kilo2` names.",
    "Use only the `kilo2` names. Restart opencode afterwards.",
  )
  const line = added.split("\n").findIndex((text) => text.includes("Restart opencode afterwards.")) + 1
  expect(line).toBeGreaterThan(20)
  expect(KiloBrandingAudit.check(file, source).unexpected).toEqual([])
  expect(KiloBrandingAudit.check(file, added).unexpected).toMatchObject([
    { line, kind: "missing-interception", snippet: expect.stringContaining("Restart opencode afterwards.") },
  ])
  // A rule gap in an intercepted prompt points at the leftover name as well.
  const intercepted = KiloBranding.files.find((name) => name.endsWith(".txt"))!
  expect(
    KiloBrandingAudit.auditFile(intercepted, "# Role\n\nYou use tools.\nReport to OpenCodeTools when done.\n"),
  ).toEqual([
    {
      file: intercepted,
      line: 4,
      column: 11,
      kind: "rule-gap",
      snippet: "# Role  You use tools. Report to OpenCodeTools when done.",
    },
  ])
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
  // `fn` names a span only on Effect: the same token as the argument of another `fn` is text.
  expect(
    KiloBrandingAudit.auditFile(key, 'export const label = ui.fn("OpenCodeTools.Plugin")').map((f) => f.kind),
  ).toEqual(["rule-gap"])
  expect(
    KiloBrandingAudit.auditFile("cli/src/not-intercepted.ts", 'ui.fn("OpenCode hint")').map((f) => f.kind),
  ).toEqual(["missing-interception"])
  // A span name is not a finding in any of its call shapes: `withSpan` on any receiver, data-first, or a template.
  const file = "cli/src/not-intercepted.ts"
  for (const call of [
    'Effect.fn("OpenCode.load")',
    "Effect.fn(`OpenCode.${id}`)",
    'Stream.withSpan("OpenCode stream")',
    'tracer.withSpan("OpenCode trace")',
    'Effect.withSpan(work, "OpenCode first")',
    "Effect.withSpan(`OpenCode ${id} step`)",
  ])
    expect(KiloBrandingAudit.auditFile(file, call), call).toEqual([])
  expect(KiloBrandingAudit.auditFile(key, 'export const stream = Stream.withSpan("OpenCodeTools.stream")')).toEqual([])
  // Only the name: another string of the same call is still a finding.
  for (const call of [
    'Stream.withSpan("OpenCode stream", { attributes: { label: "Restart OpenCode" } })',
    'Effect.withSpan(work, "OpenCode first", { attributes: { label: "Restart OpenCode" } })',
    'Effect.withSpan("OpenCode name", "Restart OpenCode")',
  ])
    expect(
      KiloBrandingAudit.auditFile(file, call).map((f) => [f.kind, f.snippet]),
      call,
    ).toEqual([["missing-interception", "Restart OpenCode"]])
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
  const { unexpected, stale, unparseable, bare } = await KiloBrandingAudit.run()
  expect(bare).toEqual([])
  expect(unexpected.map((f) => `${f.file}:${f.line} ${f.snippet}`)).toEqual([])
  // A file the audit cannot parse is left unchecked, so it must fail, not skip.
  expect(unparseable.map((u) => `${u.file}: ${u.error}`)).toEqual([])
  // A stale allowlist entry (a file with no findings, a snippet that accounts for none) should be removed, not left
  // to rot.
  expect(stale).toEqual([])
}, 120_000)
