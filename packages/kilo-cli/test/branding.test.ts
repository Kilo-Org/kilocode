import { expect, test } from "bun:test"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/text"
import { compileDefine } from "./fixtures/compile-define"
import { repo, run, temporary } from "./fixtures/branding-run"

const entry = path.join(import.meta.dir, "fixtures/branding.ts")

for (const [file, replacements] of Object.entries(KiloBranding.replacements)) {
  test(`brands only the selected text in ${file}`, async () => {
    const filename = path.join(repo, "packages", file)
    const original = await Bun.file(filename).text()
    const branded = KiloBranding.transform(filename, original)
    for (const [from, to] of replacements) {
      expect(branded).toContain(to)
      expect(branded.split(from).length - 1).toBe(
        (original.replaceAll("\r\n", "\n").split(from).length - 1) * (to.split(from).length - 1),
      )
    }
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

test("no core prompt template names OpenCode", async () => {
  const files = Array.from(new Bun.Glob("core/src/**/*.txt").scanSync(path.join(repo, "packages"))).filter(
    // The models.dev snapshot is provider data, not a prompt.
    (file) => !file.replaceAll("\\", "/").endsWith("models-dev/snapshot.txt"),
  )
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const filename = path.join(repo, "packages", file)
    const branded = KiloBranding.transform(filename, await Bun.file(filename).text())
    // The ${OPENCODE_TOOL_GUIDANCE} token is replaced by SessionSystemPrompt.render, not prose.
    expect(branded.replaceAll("${OPENCODE_TOOL_GUIDANCE}", ""), file).not.toMatch(/opencode/i)
  }
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
  for (const file of Object.keys(KiloBranding.replacements)) {
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

test("fails clearly if an upstream text anchor changes", () => {
  expect(() => KiloBranding.transform("/repo/packages/tui/src/util/error.ts", "changed")).toThrow(
    "Kilo branding no longer matches",
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
    prompt: string
  }
  // Proves the .txt loader branch runs in the source and compiled paths, not only KiloBranding.transform.
  expect(pages.prompt).toContain(`running in ${hosted ? "Kilo" : "OpenCode"}, a coding agent harness`)
  expect(pages.prompt).not.toContain(`running in ${hosted ? "OpenCode" : "Kilo"}`)
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
