import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { RGBA, TextAttributes } from "@opentui/core"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/text"
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
      expect(branded.split(from).length - 1).toBe(
        (original.replaceAll("\r\n", "\n").split(from).length - 1) * (to.split(from).length - 1),
      )
    }
    expect(branded.match(/@opencode\/[\w/.-]+/g)).toEqual(original.match(/@opencode\/[\w/.-]+/g))
  })
}

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
