import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { RGBA, TextAttributes } from "@opentui/core"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/transform"
import { KiloLogo } from "../src/branding/logo-art"
import { logo, go } from "../../tui/src/logo"
import { createPluginRuntimePlugin } from "../script/plugin-runtime"

const repo = path.resolve(import.meta.dir, "../../..")
const entry = path.join(import.meta.dir, "fixtures/branding.ts")

for (const [file, replacements] of Object.entries(KiloBranding.replacements)) {
  test(`brands only the selected text in ${file}`, async () => {
    const filename = path.join(repo, "packages", file)
    const original = await Bun.file(filename).text()
    const branded = KiloBranding.transform(filename, original)
    for (const [from, to] of replacements) {
      expect(branded).toContain(to)
      if (!to.includes(from)) expect(branded).not.toContain(from)
    }
    expect(branded.match(/@opencode\/[\w/.-]+/g)).toEqual(original.match(/@opencode\/[\w/.-]+/g))
  })
}

test("branding is independent of LF or CRLF checkouts", async () => {
  for (const file of Object.keys(KiloBranding.replacements)) {
    const filename = path.join(repo, "packages", file)
    const lf = (await Bun.file(filename).text()).replaceAll("\r\n", "\n")
    const crlf = lf.replaceAll("\n", "\r\n")
    expect(KiloBranding.transform(filename, crlf)).toBe(KiloBranding.transform(filename, lf))
  }
})

test("brands new display wording without changing identifiers or provider names", () => {
  const source = `import { OpenCode } from "@opencode/client"
const id = "opencode"
const schema = "https://opencode.ai/config.json"
const options = { description: "OpenCode has a new feature", id: "OpenCode" }
const link = { description: "See https://example.com/opencode.json" }
const view = <box><text>Start OpenCode now</text><text>OpenCode Go is available</text><text>OpenCode Zen is available</text><input placeholder="Ask OpenCode" /></box>
const call = OpenCode.make({ title: "OpenCode Console" })
`
  const branded = KiloBranding.transform("/repo/packages/tui/src/component/new-view.tsx", source)
  expect(branded).toContain('description: "Kilo has a new feature"')
  expect(branded).toContain(">Start Kilo now</text>")
  expect(branded).toContain('placeholder="Ask Kilo"')
  expect(branded).toContain('id: "OpenCode"')
  expect(branded).toContain('const id = "opencode"')
  expect(branded).toContain('"https://opencode.ai/config.json"')
  expect(branded).toContain('"See https://example.com/opencode.json"')
  expect(branded).toContain('from "@opencode/client"')
  expect(branded).toContain("OpenCode Go is available")
  expect(branded).toContain("OpenCode Zen is available")
  expect(branded).toContain('title: "OpenCode Console"')
})

test("changes only approved display calls and arguments", () => {
  const source = `import { log } from "@clack/prompts"
cache.write("OpenCode token", "OpenCode value")
cache.write("OpenCode key", { description: "OpenCode data" })
client.warn("OpenCode input")
log.info("OpenCode is ready", { message: "OpenCode metadata" })
process.stderr.write("OpenCode is ready")
process.stderr.write(cache.read("OpenCode token"))
function example(process) { process.stderr.write("OpenCode input") }
function another(log) { log.info("OpenCode data") }
function epilogue() { cache.write("OpenCode token"); return "finished" }
const DEFAULT_TITLE = cache.read("OpenCode token")
const view = <text placeholder={cache.read("OpenCode token")}>Ready</text>
`
  const result = KiloBranding.transform("/repo/packages/tui/src/new-view.tsx", source)
  expect(result).toContain('cache.write("OpenCode token", "OpenCode value")')
  expect(result).toContain('cache.write("OpenCode key", { description: "OpenCode data" })')
  expect(result).toContain('client.warn("OpenCode input")')
  expect(result).toContain('log.info("Kilo is ready", { message: "OpenCode metadata" })')
  expect(result).toContain('process.stderr.write("Kilo is ready")')
  expect(result).toContain('process.stderr.write(cache.read("OpenCode token"))')
  expect(result).toContain('function example(process) { process.stderr.write("OpenCode input") }')
  expect(result).toContain('function another(log) { log.info("OpenCode data") }')
  expect(result).toContain('function epilogue() { cache.write("OpenCode token"); return "finished" }')
  expect(result).toContain('const DEFAULT_TITLE = cache.read("OpenCode token")')
  expect(result).toContain('placeholder={cache.read("OpenCode token")}')
})

test("brands rendered expression branches without branding predicates or inputs", () => {
  const source =
    'const view = <text>{status === "OpenCode" ? `Hello OpenCode ${name}` : "Try OpenCode"}{cache.read("OpenCode token")}</text>'
  const result = KiloBranding.transform("/repo/packages/tui/src/new-view.tsx", source)
  expect(result).toContain('status === "OpenCode"')
  expect(result).toContain("`Hello Kilo ${name}`")
  expect(result).toContain('"Try Kilo"')
  expect(result).toContain('cache.read("OpenCode token")')
})

test("does not brand predicates, lookup keys or data computation arguments", () => {
  const source = `import { log } from "@clack/prompts"
const first = { description: kind === "OpenCode" ? "Yes" : "No" }
const second = { description: records["OpenCode"] }
const third = { description: kind === "OpenCode" ? "OpenCode selected" : "OpenCode fallback" }
const fourth = { description: records?.["OpenCode"] ?? "OpenCode fallback" }
const fifth = { description: format("OpenCode") }
const sixth = { description: \`OpenCode result: \${format("OpenCode")}\` }
const input = <input placeholder={kind === "OpenCode" ? "Ask OpenCode" : records["OpenCode"]} />
log.info(kind === "OpenCode" ? "OpenCode selected" : records["OpenCode"])
process.stdout.write([kind === "OpenCode" ? "OpenCode selected" : records["OpenCode"]].join(""))
`
  const result = KiloBranding.transform("/repo/packages/tui/src/new-view.tsx", source)
  expect(result).toContain('description: kind === "OpenCode" ? "Yes" : "No"')
  expect(result).toContain('description: records["OpenCode"]')
  expect(result).toContain('description: kind === "OpenCode" ? "Kilo selected" : "Kilo fallback"')
  expect(result).toContain('description: records?.["OpenCode"] ?? "Kilo fallback"')
  expect(result).toContain('description: format("OpenCode")')
  expect(result).toContain('description: `Kilo result: ${format("OpenCode")}`')
  expect(result).toContain('placeholder={kind === "OpenCode" ? "Ask Kilo" : records["OpenCode"]}')
  expect(result).toContain('log.info(kind === "OpenCode" ? "Kilo selected" : records["OpenCode"])')
  expect(result).toContain(
    'process.stdout.write([kind === "OpenCode" ? "Kilo selected" : records["OpenCode"]].join(""))',
  )
})

test("brands mixed prose while preserving URLs and provider names", () => {
  const source = String.raw`const item = { description: "OpenCode, OpenCode Go and OpenCode Zen: see https://opencode.ai/opencode.json and https:\/\/example.com/opencode.json for OpenCode Console at opencode.ai" }`
  const result = KiloBranding.transform("/repo/packages/tui/src/new-view.ts", source)
  expect(result).toContain(
    String.raw`"Kilo, OpenCode Go and OpenCode Zen: see https://opencode.ai/opencode.json and https:\/\/example.com/opencode.json for OpenCode Console at opencode.ai"`,
  )
})

test("brands mini, pairing and crash display contexts", async () => {
  const files = [
    "tui/src/mini/splash.ts",
    "cli/src/commands/handlers/pair.ts",
    "tui/src/component/dialog-update.tsx",
    "tui/src/component/error-component.tsx",
  ]
  const results = await Promise.all(
    files.map(async (file) => {
      const filename = path.join(repo, "packages", file)
      return KiloBranding.transform(filename, await Bun.file(filename).text())
    }),
  )
  expect(results[0]).toContain("`kilo2 mini -s ${meta.session_id}`")
  expect(results[1]).toContain("run `kilo2 service set hostname 0.0.0.0`")
  expect(results[1]).toContain("run `kilo2 pair`")
  expect(results[2]).toContain("`Installing Kilo ${current.version}…`")
  expect(results[3]).toContain("Reported automatically from the Kilo crash screen")
  expect(results[3]).toContain("The Kilo TUI crashed with an unexpected error")
  expect(results[3]).toContain('url.searchParams.set("opencode-version", version)')
  expect(results[3]).toContain("https://github.com/Kilo-Org/kilocode/issues/new?template=bug-report.yml")
})

test("selects update and ACP semantics independently of display wording", async () => {
  const commandsFile = path.join(repo, "packages/cli/src/commands/commands.ts")
  const commands = (await Bun.file(commandsFile).text()).replace(
    "Upgrade OpenCode to the latest or a specific version",
    "Install a future OpenCode release",
  )
  expect(KiloBranding.transform(commandsFile, commands)).toContain("Show manual Kilo update instructions")
  const appFile = path.join(repo, "packages/tui/src/app.tsx")
  const app = (await Bun.file(appFile).text()).replace("Update OpenCode", "Install OpenCode updates")
  const brandedApp = KiloBranding.transform(appFile, app)
  expect(brandedApp).toContain("Kilo update instructions")
  expect(brandedApp).toContain("https://kilo.ai/docs")
  const acpFile = path.join(repo, "packages/cli/src/acp/service.ts")
  const acp = (await Bun.file(acpFile).text())
    .replace("Login with opencode", "Sign in with opencode now")
    .replace('agentInfo: { name: "OpenCode"', 'agentInfo: { name: "OpenCode Agent"')
  const brandedAcp = KiloBranding.transform(acpFile, acp)
  expect(brandedAcp).toContain('name: "Sign in with Kilo now"')
  expect(brandedAcp).toContain('agentInfo: { name: "Kilo Agent"')
  expect(brandedAcp).toContain('command: "kilo2"')
  expect(brandedAcp).toContain('const AuthMethodID = "opencode-login"')
  const statsFile = path.join(repo, "packages/tui/src/feature-plugins/system/stats.tsx")
  const stats = (await Bun.file(statsFile).text())
    .replace("opencode / stats", "opencode / usage")
    .replace(">opencode.ai<", ">Visit opencode.ai today<")
  const brandedStats = KiloBranding.transform(statsFile, stats)
  expect(brandedStats).toContain("kilo2 / usage")
  expect(brandedStats).toContain("Visit kilo.ai today")
})

for (const hosted of [false, true]) {
  test(`new source and compiled modules ${hosted ? "use Kilo" : "keep upstream branding"}`, async () => {
    await using root = await temporary()
    const directory = path.join(root.path, "packages/tui/src")
    await mkdir(directory, { recursive: true })
    const filename = path.join(directory, "new-branding.ts")
    await Bun.write(
      filename,
      'const cache = { write: (key, value) => [key, value] }; const stored = cache.write("OpenCode token", "OpenCode value"); const item = { description: "OpenCode has another feature", id: "opencode", stored }; console.log(JSON.stringify(item))',
    )
    const preload = path.join(repo, "packages/kilo-cli/src/branding/preload.ts")
    const source = await run([process.execPath, ...(hosted ? ["--preload", preload] : []), filename], root.path, false)
    const outfile = path.join(root.path, "new-branding")
    const built = await Bun.build({
      entrypoints: [filename],
      plugins: hosted ? [brandingPlugin] : [],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
    })
    expect(built.success, built.logs.map(String).join("\n")).toBe(true)
    const compiled = await run([outfile], root.path, false)
    const expected = {
      description: `${hosted ? "Kilo" : "OpenCode"} has another feature`,
      id: "opencode",
      stored: ["OpenCode token", "OpenCode value"],
    }
    expect(JSON.parse(source)).toEqual(expected)
    expect(JSON.parse(compiled)).toEqual(expected)
  }, 60_000)
}

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

test("brands ACP display fields without changing protocol identifiers", async () => {
  const files = ["cli/src/acp/service.ts", "cli/src/acp/agent.ts", "cli/src/acp/error.ts", "cli/src/acp/translate.ts"]
  const sources = await Promise.all(
    files.map(async (file) => {
      const filename = path.join(repo, "packages", file)
      return KiloBranding.transform(filename, await Bun.file(filename).text())
    }),
  )
  expect(sources[0]).toContain('const AuthMethodID = "opencode-login"')
  expect(sources[0]).toContain('name: "Login with Kilo"')
  expect(sources[0]).toContain('"terminal-auth": { command: "kilo2", args: ["auth", "login"], label: "Kilo Login" }')
  expect(sources[0]).toContain('agentInfo: { name: "Kilo"')
  expect(sources[0]).toContain('command: "kilo2"')
  expect(sources[1]).toContain('agent({ name: "opencode" })')
  expect(sources[2]).toContain("Kilo server is unavailable")
  expect(sources[3]).toContain("Kilo prompt failed")
})

test("retains branding across existing CLI and TUI display surfaces", async () => {
  const cases = [
    ["cli/src/services/service-config.ts", "Usage: kilo2 service get"],
    ["cli/src/server-process.ts", "kilo2 service set port"],
    ["cli/src/services/remote-tunnel.ts", "kilo2 service set remote true"],
    ["cli/src/commands/handlers/mcp/auth.ts", "kilo2 mcp add"],
    ["cli/src/commands/handlers/acp.ts", "kilo2 acp:"],
    ["cli/src/commands/handlers/default.ts", "Kilo update could not start"],
    ["cli/src/commands/handlers/uninstall.ts", "shared by Kilo versions and channels"],
    ["cli/src/services/update-preflight.tsx", '"Loading Kilo"'],
    ["tui/src/routes/session/permission.tsx", "Tell Kilo what to do differently"],
    ["tui/src/mini/footer.permission.tsx", "Tell Kilo what to do differently"],
    ["tui/src/mini/footer.prompt.tsx", 'description: "close Kilo"'],
    ["tui/src/component/terminal-pane.tsx", "restart Kilo"],
    ["tui/src/feature-plugins/sidebar/footer.tsx", "Kilo includes free models"],
    ["tui/src/config/index.tsx", 'description: "Show the release highlights once after Kilo updates"'],
  ]
  for (const [file, expected] of cases) {
    const filename = path.join(repo, "packages", file)
    expect(KiloBranding.transform(filename, await Bun.file(filename).text()), file).toContain(expected)
  }
})

test("keeps OAuth predicate and lookup data unchanged", async () => {
  const filename = path.join(repo, "packages/core/src/oauth/page.ts")
  const source = (await Bun.file(filename).text()).replace(
    "const provider = options?.provider",
    'const provider = records["OpenCode"] === "OpenCode" ? options?.provider : undefined',
  )
  const result = KiloBranding.transform(filename, source)
  expect(result).toContain('records["OpenCode"] === "OpenCode"')
  expect(result).toContain("Kilo is now authorized.")
})

test("brands the mini terminal error at its shared definition", async () => {
  const filename = path.join(repo, "packages/cli/src/mini-host.ts")
  const result = KiloBranding.transform(filename, await Bun.file(filename).text())
  expect(result).toContain('INTERACTIVE_INPUT_ERROR = "kilo2 mini requires a controlling terminal for input"')
})

test("brands diagnostic prompts and statistics displays", async () => {
  for (const file of [
    "tui/src/util/error-details.ts",
    "cli/src/commands/handlers/stats.ts",
    "tui/src/feature-plugins/system/stats.tsx",
  ]) {
    const filename = path.join(repo, "packages", file)
    const result = KiloBranding.transform(filename, await Bun.file(filename).text())
    if (file.includes("error-details")) {
      expect(result).toContain("this Kilo component")
      expect(result).toContain("global Kilo configuration")
    } else {
      expect(result).toContain("kilo.ai")
      expect(result).toContain("kilo2")
    }
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
  expect(() => KiloBranding.transform("/repo/packages/tui/src/util/presentation.ts", "changed")).toThrow(
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
      define: { KILO_BRANDING_COMPILED: "true" },
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
      define: { KILO_BRANDING_COMPILED: "true" },
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

for (const hosted of [false, true]) {
  for (const modern of [false, true]) {
    test(`source logo layouts: ${hosted ? "Kilo" : "upstream"}, ${modern ? "modern" : "fallback"}`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/logo-render.ts")
      checkLogos(await run([process.execPath, fixture, modern ? "1" : "0"], root.path, hosted), hosted, modern)
    }, 60_000)

    test(`compiled logo layouts: ${hosted ? "Kilo" : "upstream"}, ${modern ? "modern" : "fallback"}`, async () => {
      await using root = await temporary()
      const outfile = path.join(root.path, process.platform === "win32" ? "logo.exe" : "logo")
      const result = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "fixtures/logo-render.ts")],
        plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin()],
        compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
        define: { KILO_BRANDING_COMPILED: "true" },
      })
      expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      checkLogos(await run([outfile, modern ? "1" : "0"], root.path, !hosted), hosted, modern)
    }, 60_000)
  }
}

function checkLogos(output: string, hosted: boolean, modern: boolean) {
  const result = JSON.parse(output) as {
    frames: {
      width: number
      height: number
      mode: "dark" | "light"
      frame: string
      spans: { text: string; fg: number[]; bg: number[]; attributes: number }[]
    }[]
    assets: { logo: typeof logo; go: typeof go; compact?: string[]; widths?: { split: number; full: number } }
  }
  const art = KiloLogo.art({ KILO_UNICODE_LOGO: modern ? "1" : "0" })
  expect(result.assets.go).toEqual(go)
  expect(result.assets.logo).toEqual(hosted ? art.logo : logo)
  expect(result.assets.compact).toEqual(hosted ? art.compact : undefined)
  expect(result.assets.widths).toEqual(hosted ? art.widths : undefined)
  expect(result.frames).toHaveLength(42)
  for (const { width, height, mode, frame, spans } of result.frames) {
    if (height < 12) {
      expect(frame.trim()).toBe("")
      continue
    }
    const compact = hosted ? art.compact : go.right.slice(1)
    const split = hosted ? [...art.logo.left, ...art.logo.right] : [...logo.left.slice(1), ...logo.right]
    const full = (hosted ? art.logo : logo).left.map(
      (line, index) => `${line} ${(hosted ? art.logo : logo).right[index]}`,
    )
    const rows =
      width < (hosted ? art.widths.split + 2 : 22)
        ? compact
        : width < (hosted ? art.widths.full + 4 : 44)
          ? split
          : full
    if (hosted) {
      const ink = RGBA.fromHex(mode === "light" ? "#736400" : "#FFDD00").toInts()
      expect(frame.match(/v2/g) ?? []).toHaveLength(rows === compact ? 0 : 1)
      const suffix = spans.find((span) => span.text.includes("v2"))
      if (rows !== compact) {
        expect(suffix?.fg).toEqual(ink)
        expect(suffix!.attributes & TextAttributes.BOLD).toBe(0)
        if (mode === "light") expect(contrast(suffix!.fg, suffix!.bg)).toBeGreaterThanOrEqual(4.5)
      }
      const strokes = spans.filter((span) => span.text.includes("█"))
      expect(strokes.length).toBeGreaterThan(0)
      for (const span of strokes) {
        expect(span.fg).toEqual(ink)
        expect(span.attributes & TextAttributes.BOLD).toBe(0)
        if (mode === "light") expect(contrast(span.fg, span.bg)).toBeGreaterThanOrEqual(4.5)
      }
      const shadows = spans.filter((span) => span.fg.some((value, index) => value !== ink[index]))
      expect(shadows.length > 0).toBe(rows !== compact)
      for (const span of shadows) {
        expect(span.text.trim()).toMatch(/^▀+$/)
        expect(span.fg).not.toEqual(ink)
        if (mode === "light") expect(contrast(span.fg, span.bg)).toBeGreaterThanOrEqual(3)
      }
    }
    for (const line of rows) {
      const visible = line.replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀").replaceAll(",", "▄").trimEnd()
      if (visible.trim()) expect(frame).toContain(visible)
    }
    for (const line of frame.split("\n")) expect(Bun.stringWidth(line.trimEnd())).toBeLessThanOrEqual(width)
    if (hosted) expect(frame).not.toContain("█▀▀█ █▀▀█ █▀▀█ █▀▀▄")
  }
}

function contrast(foreground: number[], background: number[]) {
  const fg = luminance(foreground) + 0.05
  const bg = luminance(background) + 0.05
  return Math.max(fg, bg) / Math.min(fg, bg)
}

function luminance(rgb: number[]) {
  const linear = rgb.slice(0, 3).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

for (const hosted of [false, true]) {
  for (const columns of [0, 44, 48, 52, 53, 55, 56, 72, 120]) {
    test(`source epilogue: ${hosted ? "Kilo" : "upstream"}, ${columns} columns`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/epilogue.ts")
      checkEpilogue(await run([process.execPath, fixture, String(columns)], root.path, hosted), hosted, columns)
    }, 30_000)
  }

  test(`compiled epilogue: ${hosted ? "Kilo" : "upstream"}, 48 columns`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "epilogue.exe" : "epilogue")
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "fixtures/epilogue.ts")],
      plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin()],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: { KILO_BRANDING_COMPILED: "true" },
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    checkEpilogue(await run([outfile, "48"], root.path, !hosted), hosted, 48)
    for (const scenario of ["update", "both", "none"] as const) {
      checkEpilogue(await run([outfile, "48", scenario], root.path, !hosted), hosted, 48, scenario)
    }
  }, 60_000)

  for (const scenario of ["update", "both", "none"] as const) {
    test(`source ${scenario} epilogue: ${hosted ? "Kilo" : "upstream"}`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/epilogue.ts")
      for (const columns of hosted ? [20, 120] : [48, 120]) {
        checkEpilogue(
          await run([process.execPath, fixture, String(columns), scenario], root.path, hosted),
          hosted,
          columns,
          scenario,
        )
      }
    }, 30_000)
  }
}

for (const hosted of [false, true]) {
  for (const columns of [
    [120, 48],
    [48, 120],
    [48, 53],
    [55, 56],
    [56, 55],
    [120, 48, 120, 48],
  ]) {
    test(`source resize epilogue: ${hosted ? "Kilo" : "upstream"}, ${columns.join("-")}`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/epilogue-resize.ts")
      const output = await run([process.execPath, fixture, ...columns.map(String)], root.path, hosted)
      checkEpilogue(output, hosted, columns.at(-1)!)
    }, 30_000)
  }

  test(`compiled resize epilogue: ${hosted ? "Kilo" : "upstream"}`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "epilogue-resize.exe" : "epilogue-resize")
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "fixtures/epilogue-resize.ts")],
      plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin(), createPluginRuntimePlugin()],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: { KILO_BRANDING_COMPILED: "true" },
    })
    expect(result.success, result.logs.map(String).join("\n")).toBe(true)
    for (const columns of [
      [120, 48],
      [48, 120],
      [48, 53],
      [55, 56],
      [56, 55],
    ]) {
      const output = await run([outfile, ...columns.map(String)], root.path, !hosted)
      checkEpilogue(output, hosted, columns.at(-1)!)
    }
  }, 60_000)
}

function checkEpilogue(output: string, hosted: boolean, columns: number, scenario = "session") {
  if (scenario === "none") {
    expect(output).toBe("")
    return
  }
  const lines = Bun.stripANSI(output.trimEnd()).split("\n")
  const artLines = lines.filter((line) => /[█▀▄]/.test(line))
  const art = KiloLogo.art({})
  const full = hosted ? art.logo : logo
  const expected =
    hosted && columns > 0 && columns < art.widths.full + 2
      ? art.compact
      : full.left.map((line, index) => `${line} ${full.right[index]}`)
  expect(artLines).toEqual(
    expected.map((line) => `  ${line.replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀")}`),
  )
  if (scenario === "session" || scenario === "both") {
    expect(output).toContain("Session")
    expect(output).toContain(`${hosted ? "kilo2" : "opencode"} -s ses_example`)
  }
  if (scenario === "update" || scenario === "both") {
    expect(Bun.stripANSI(output)).toContain(`Run ${hosted ? "kilo2" : "opencode"} to use 2.1.4`)
  }
  if (columns > 0) for (const line of artLines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
}

test("source/compiled epilogue anchors are applied", async () => {
  const filename = path.join(repo, "packages/tui/src/util/presentation.ts")
  const source = KiloBranding.transform(filename, await Bun.file(filename).text())
  expect(source).toContain("widths.full + pad.length")
})

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

async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-branding-"))
  return { path: directory, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}

async function run(command: string[], root: string, hosted: boolean, exitCode = 0) {
  const child = Bun.spawn(command, {
    cwd: repo,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key)),
      ),
      BUN_OPTIONS: "",
      KILO_V2_PROFILE: path.join(root, "profile"),
      HOME: root,
      USERPROFILE: root,
      OPENCODE_TEST_HOME: root,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      KILO_BRANDING_TEST_HOSTED: hosted ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15_000,
    killSignal: "SIGKILL",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(exitCode)
  return stdout + (exitCode ? stderr : "")
}
