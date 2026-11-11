import { expect, test } from "bun:test"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/text"
import { KiloBrandingStructural } from "../src/branding/structural"
import { compileDefine } from "./fixtures/compile-define"
import { repo, run, temporary } from "./fixtures/branding-run"

const entry = path.join(import.meta.dir, "fixtures/branding.ts")

test("every structural target is an intercepted file", () => {
  // A structural transform only runs for files the loader intercepts, so each
  // structural key must appear in the interception list or it silently no-ops.
  for (const key of KiloBrandingStructural.keys) expect(KiloBranding.files).toContain(key)
})

for (const file of KiloBranding.files) {
  test(`rebrands ${file} without touching @opencode specifiers`, async () => {
    const filename = path.join(repo, "packages", file)
    const original = await Bun.file(filename).text()
    const branded = KiloBranding.transform(filename, original)
    // Every intercepted file has something to rebrand, so the pipeline must
    // change it, and it must never rewrite an @opencode import specifier.
    expect(branded).not.toBe(original.replaceAll("\r\n", "\n"))
    expect(branded.match(/@opencode\/[\w/.-]+/g)).toEqual(original.match(/@opencode\/[\w/.-]+/g))
  })
}

test("brands the built-in tool namespace to kilo", async () => {
  for (const file of [
    "core/src/tool/plugin/opencode.ts",
    "core/src/tool/plugin/artifact.ts",
    "core/src/tool/plugin/schedule.ts",
    "core/src/tool/plugin/mcp-resource.ts",
  ]) {
    const filename = path.join(repo, "packages", file)
    const branded = KiloBranding.transform(filename, await Bun.file(filename).text())
    expect(branded).not.toContain('namespace: "opencode"')
    expect(branded).toContain('namespace: "kilo"')
  }
})

test("brands the namespace of the tools a schedule check may not call", async () => {
  const filename = path.join(repo, "packages/core/src/schedule/check.ts")
  const branded = KiloBranding.transform(filename, await Bun.file(filename).text())
  expect(branded).not.toContain('"opencode.')
  expect(branded).toContain('"kilo.session_move"')
})

test("does not rewrite the upstream theme registry", async () => {
  const filename = path.join(repo, "packages/tui/src/theme/index.ts")
  const original = await Bun.file(filename).text()
  expect(KiloBranding.transform(filename, original)).toBe(original)
})

test("does not rewrite CLI or ACP executable selection", async () => {
  for (const [file, anchor] of [
    ["cli/src/commands/commands.ts", 'typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode"'],
    ["cli/src/acp/service.ts", 'command: "opencode"'],
  ] as const) {
    const filename = path.join(repo, "packages", file)
    const original = await Bun.file(filename).text()
    expect(original).toContain(anchor)
    expect(KiloBranding.transform(filename, original)).toContain(anchor)
  }
  const filename = path.join(repo, "packages/cli/src/acp/agent.ts")
  const original = await Bun.file(filename).text()
  expect(KiloBranding.transform(filename, original)).toBe(original)
})

test("branding is independent of LF or CRLF checkouts", async () => {
  for (const file of KiloBranding.files) {
    const filename = path.join(repo, "packages", file)
    const lf = (await Bun.file(filename).text()).replaceAll("\r\n", "\n")
    const crlf = lf.replaceAll("\n", "\r\n")
    expect(KiloBranding.transform(filename, crlf)).toBe(KiloBranding.transform(filename, lf))
  }
})

test("leaves line endings in unmapped modules untouched", () => {
  const source = 'export const provider = "opencode";\r\n'
  expect(KiloBranding.transform("unmapped.ts", source)).toBe(source)
})

test("still rejects real preflight drift in a CRLF checkout", async () => {
  const filename = path.join(repo, "packages/cli/src/services/update-preflight.tsx")
  const source = (await Bun.file(filename).text())
    .replaceAll("\r\n", "\n")
    .replaceAll("\n", "\r\n")
    .replace("<For each={monogram}>", "<For each={different}>")
  expect(() => KiloBranding.transform(filename, source)).toThrow("Kilo branding no longer matches")
})

test("does not rename provider identities, theme schemas or wire identifiers", async () => {
  for (const file of [
    "tui/src/util/tool-display.ts",
    "tui/src/theme/assets/v2/opencode.json",
    "cli/src/services/standalone.ts",
  ]) {
    const filename = path.join(repo, "packages", file)
    const original = await Bun.file(filename).text()
    expect(KiloBranding.transform(filename, original)).toBe(original)
  }
})

test("config hints name a file that the Kilo host reads and writes", async () => {
  expect(KiloConfigFiles.names).toContain(KiloConfigFiles.newFile)
  for (const file of ["cli/src/commands/handlers/mcp/auth.ts", "tui/src/util/error.ts"]) {
    const filename = path.join(repo, "packages", file)
    const branded = KiloBranding.transform(filename, await Bun.file(filename).text())
    expect(branded).toContain(KiloConfigFiles.newFile)
    expect(branded).not.toContain("kilo.json")
    expect(branded).not.toContain("opencode.json")
  }
})

test("fails loudly when a structural anchor drifts", () => {
  expect(() => KiloBranding.transform("/repo/packages/tui/src/util/presentation.ts", "changed")).toThrow(
    "Kilo branding no longer matches",
  )
})

test("fails loudly when upstream adds an occurrence a structural anchor would over-match", async () => {
  // The guard is a count, not just presence: a newly introduced occurrence of a
  // repeated anchor (here the 3x `theme.text.base, true` in logo.tsx) must throw
  // rather than be rewritten silently by replaceAll.
  const filename = path.join(repo, "packages/tui/src/component/logo.tsx")
  const source = (await Bun.file(filename).text()).replace(
    "theme.text.base, true",
    "theme.text.base, true\n      renderLine(line, theme.text.base, true)",
  )
  expect(() => KiloBranding.transform(filename, source)).toThrow("Kilo branding no longer matches")
})

test("fails loudly when a semantic override anchor drifts", () => {
  // acp/service.ts is an override file but not a structural one, so this hits the
  // override presence guard, not structural.apply.
  expect(() => KiloBranding.transform("/repo/packages/cli/src/acp/service.ts", "changed")).toThrow(
    "Kilo branding no longer matches",
  )
})

test("brands user-visible text dynamically instead of failing on an unknown anchor", () => {
  // A text-only module whose wording no longer matches any specific anchor is
  // not an error: the rule engine brands what it recognizes and leaves the rest
  // for the branding audit, rather than throwing like the old exact list.
  expect(KiloBranding.transform("/repo/packages/tui/src/util/error.ts", 'const help = "Restart opencode now"')).toBe(
    'const help = "Restart kilo2 now"',
  )
  expect(KiloBranding.transform("/repo/packages/tui/src/util/error.ts", 'const ok = "nothing to rebrand"')).toBe(
    'const ok = "nothing to rebrand"',
  )
})

for (const hosted of [false, true]) {
  test(`source OAuth pages ${hosted ? "use Kilo" : "keep upstream branding"}`, async () => {
    await using root = await temporary()
    checkPages(await run([process.execPath, entry], root.path, hosted), hosted)
  })

  test(`compiled OAuth pages ${hosted ? "use Kilo" : "keep upstream branding"}`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "pages.exe" : "pages")
    const result = await Bun.build({
      entrypoints: [entry],
      plugins: hosted ? [brandingPlugin] : [],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: compileDefine,
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    checkPages(await run([outfile], root.path, !hosted), hosted)
  }, 60_000)
}

for (const hosted of [false, true]) {
  test(`source TSX renders ${hosted ? "Kilo" : "upstream"} branding`, async () => {
    await using root = await temporary()
    const fixture = path.join(import.meta.dir, "fixtures/branding-tsx.ts")
    checkOnboarding(await run([process.execPath, fixture], root.path, hosted), hosted)
  }, 30_000)

  test(`compiled TSX renders ${hosted ? "Kilo" : "upstream"} branding`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "sidebar.exe" : "sidebar")
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "fixtures/branding-tsx.ts")],
      plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin()],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: compileDefine,
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    checkOnboarding(await run([outfile], root.path, !hosted), hosted)
  }, 60_000)
}

function checkOnboarding(output: string, hosted: boolean) {
  const frame = JSON.parse(output) as string
  expect(frame).toContain("Getting started")
  expect(frame).toContain(`${hosted ? "Kilo" : "OpenCode"} includes free models`)
  expect(frame).not.toContain(`${hosted ? "OpenCode" : "Kilo"} includes free models`)
  expect(frame).toContain("Connect provider")
}

for (const args of [["--help"], ["auth", "logout", "--help"]]) {
  test(`Kilo CLI help: ${args.join(" ")}`, async () => {
    await using root = await temporary()
    const output = await run([process.execPath, "run", "dev", ...args], root.path, true)
    expect(output).toContain("kilo2")
    expect(output).not.toContain("OpenCode")
    expect(output).not.toContain("opencode ")
  }, 30_000)
}

for (const args of [["upgrade"], ["upgrade", "99.0.0", "--method", "npm"], ["update", "99.0.0", "--method", "curl"]]) {
  test(`Kilo rejects inherited updates: ${args.join(" ")}`, async () => {
    await using root = await temporary()
    const output = await run([process.execPath, "run", "dev", ...args], root.path, true, 1)
    expect(output).toContain("Kilo updates are disabled")
    expect(output).toContain("Update Kilo manually")
    expect(output).not.toContain("opencode.ai")
  }, 30_000)
}

function checkPages(output: string, hosted: boolean) {
  const pages = JSON.parse(output) as {
    relative: string
    success: string
    error: string
    bootstrap: string
    modelError: string
    update: string
    updateSession: string
  }
  for (const output of [pages.update, pages.updateSession]) {
    const text = Bun.stripANSI(output)
    expect(text).toContain(`Run ${hosted ? "kilo2" : "opencode"} to use 2.1.4`)
    expect(text).not.toContain(hosted ? "opencode" : "kilo2")
  }
  expect(Bun.stripANSI(pages.updateSession)).toContain(`${hosted ? "kilo2" : "opencode"} -s test-session`)
  expect(pages.relative).toBe(pages.success)
  for (const html of [pages.success, pages.error, pages.bootstrap]) {
    expect(html).toContain(hosted ? "· Kilo</title>" : "· OpenCode</title>")
    expect(html).toContain(hosted ? 'aria-label="Kilo Code"' : 'aria-label="OpenCode"')
  }
  expect(pages.success).toContain("OpenCode &lt;script&gt;unsafe&lt;/script&gt;")
  expect(pages.error).toContain("&lt;img src=x onerror=alert(1)&gt;")
  expect(pages.bootstrap).toContain('var PROVIDER="\\u003c/script>\\u003cscript>unsafe\\u003c/script>"')
  expect(pages.bootstrap).toContain('var TOKEN_URL=new URL("/callback",window.location.origin).href')
  expect(pages.success).not.toContain("setTimeout(function(){try{window.close()}")
  expect(pages.modelError).toContain(`config (${hosted ? KiloConfigFiles.newFile : "opencode.json"})`)
  expect(pages.modelError).not.toContain("kilo.json")
}
