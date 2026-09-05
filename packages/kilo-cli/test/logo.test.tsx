import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { KiloLogo } from "../src/tui-plugin/logo"

const artwork = {
  wide: [
    "██  ██ ██🬺🬏   ██  ██   ██🬺🬏     ████ ██     ██🬺🬏",
    "████🬺🬏 ▀▀██   ██  ▀▀ ██▀▀██   ██▀▀▀▀ ██     ▀▀██",
    "██  ██ ██████ 🬁🬬████ 🬁🬬██▀▀   🬁🬬████ 🬁🬬████ ██████",
    "▀▀  ▀▀ ▀▀▀▀▀▀   ▀▀▀▀   ▀▀       ▀▀▀▀   ▀▀▀▀ ▀▀▀▀▀▀",
  ],
  compact: [
    "  ██  ██ ██🬺🬏   ██  ██   ██🬺🬏",
    "  ████🬺🬏 ▀▀██   ██  ▀▀ ██▀▀██",
    "  ██  ██ ██████ 🬁🬬████ 🬁🬬██▀▀",
    "  ▀▀  ▀▀ ▀▀▀▀▀▀   ▀▀▀▀   ▀▀",
  ],
  fallbackWide: [
    "██  ██ ████   ██  ██   ██       ████ ██     ████",
    "████   ▀▀██   ██  ▀▀ ██▀▀██   ██▀▀▀▀ ██     ▀▀██",
    "██  ██ ██████ ██████   ██▀▀     ████   ████ ██████",
    "▀▀  ▀▀ ▀▀▀▀▀▀  ▀▀▀▀▀   ▀▀       ▀▀▀▀   ▀▀▀▀ ▀▀▀▀▀▀",
  ],
  fallbackCompact: [
    "  ██  ██ ████   ██  ██   ██",
    "  ████   ▀▀██   ██  ▀▀ ██▀▀██",
    "  ██  ██ ██████ ██████   ██▀▀",
    "  ▀▀  ▀▀ ▀▀▀▀▀▀  ▀▀▀▀▀   ▀▀",
  ],
  tiny: ["KILO"],
}

const themes = [
  { name: "dark", fg: RGBA.fromHex("#eeeeee"), bg: RGBA.fromHex("#111111") },
  { name: "light", fg: RGBA.fromHex("#222222"), bg: RGBA.fromHex("#ffffff") },
]

for (const sample of [
  { mode: "dark", fg: "#f9f76f", bg: "#000000", shadow: [62, 62, 28, 255] },
  { mode: "light", fg: "#6f6500", bg: "#ffffff", shadow: [219, 217, 191, 255] },
] as const) {
  test(`Kilo ${sample.mode} wordmark retains a separate quarter-tint depth layer`, async () => {
    const setup = await createTestRenderer({ width: 120, height: 8, useThread: false })
    try {
      await render(
        () => (
          <box backgroundColor={sample.bg}>
            <KiloLogo fg={RGBA.fromHex(sample.fg)} bg={RGBA.fromHex(sample.bg)} env={{ KILO_UNICODE_LOGO: "true" }} />
          </box>
        ),
        setup.renderer,
      )
      await setup.renderOnce()
      const spans = setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .filter((span) => span.text.trim())
      const foreground = RGBA.fromHex(sample.fg).toInts().toString()
      const shadow = spans.filter((span) => span.fg.toInts().toString() !== foreground)
      expect(shadow.length).toBeGreaterThan(0)
      expect(shadow.every((span) => /^[▀ ]+$/.test(span.text))).toBe(true)
      expect(shadow[0].fg.toInts()).toEqual([...sample.shadow])
      expect(new Set(spans.map((span) => span.fg.toInts().toString())).size).toBe(2)
    } finally {
      setup.renderer.destroy()
    }
  })
}

for (const theme of themes) {
  test(`Kilo artwork fits wide, compact, and tiny terminals with ${theme.name} foreground`, async () => {
    for (const [width, expected] of [
      [120, artwork.wide],
      [56, artwork.wide],
      [55, artwork.compact],
      [34, artwork.compact],
      [33, artwork.tiny],
      [22, artwork.tiny],
      [4, artwork.tiny],
    ] as const) {
      const setup = await createTestRenderer({ width, height: 8, useThread: false })
      try {
        await render(
          () => (
            <box backgroundColor={theme.bg}>
              <KiloLogo
                fg={theme.fg}
                bg={theme.bg}
                width={Math.max(0, width - 4)}
                env={{ KILO_UNICODE_LOGO: "true" }}
                platform="linux"
              />
            </box>
          ),
          setup.renderer,
        )
        await setup.renderOnce()
        assertFrame(setup, expected, theme.fg)
      } finally {
        setup.renderer.destroy()
      }
    }
  })
}

const terminals: { name: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; modern: boolean }[] = [
  { name: "dumb", env: { TERM: "dumb" }, platform: "linux", modern: false },
  { name: "legacy Windows", env: {}, platform: "win32", modern: false },
  { name: "ConEmu", env: { ConEmuPID: "fixture" }, platform: "linux", modern: false },
  { name: "ANSICON", env: { ANSICON: "fixture" }, platform: "linux", modern: false },
  { name: "Windows Terminal", env: { WT_SESSION: "fixture" }, platform: "win32", modern: true },
  { name: "VS Code", env: { TERM_PROGRAM: "vscode" }, platform: "win32", modern: true },
  { name: "WezTerm", env: { TERM_PROGRAM: "WezTerm" }, platform: "win32", modern: true },
  { name: "Unix", env: {}, platform: "darwin", modern: true },
  { name: "explicit off", env: { KILO_UNICODE_LOGO: "OFF" }, platform: "darwin", modern: false },
  { name: "explicit on", env: { KILO_UNICODE_LOGO: "YES", TERM: "dumb" }, platform: "win32", modern: true },
]

for (const terminal of terminals) {
  test(`Kilo-only Unicode compatibility: ${terminal.name}`, async () => {
    for (const [width, expected] of [
      [120, terminal.modern ? artwork.wide : artwork.fallbackWide],
      [40, terminal.modern ? artwork.compact : artwork.fallbackCompact],
      [20, artwork.tiny],
    ] as const) {
      const setup = await createTestRenderer({ width, height: 8, useThread: false })
      try {
        await render(
          () => (
            <KiloLogo
              fg={themes[0].fg}
              bg={themes[0].bg}
              width={Math.max(0, width - 4)}
              env={terminal.env}
              platform={terminal.platform}
            />
          ),
          setup.renderer,
        )
        await setup.renderOnce()
        assertFrame(setup, expected, themes[0].fg)
        if (!terminal.modern) expect(setup.captureCharFrame()).not.toMatch(/[\u{1FB00}-\u{1FBFF}]/u)
      } finally {
        setup.renderer.destroy()
      }
    }
  })
}

function assertFrame(setup: Awaited<ReturnType<typeof createTestRenderer>>, expected: string[], fg: RGBA) {
  const frame = setup.captureCharFrame()
  expect(frame.toLowerCase()).not.toContain("opencode")
  expect(frame).not.toContain("~")
  expect(frameLines(frame)).toEqual(expected)
  const spans = setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .filter((span) => span.text.trim())
  expect(spans.length).toBeGreaterThan(0)
  expect(spans.some((span) => span.fg.toInts().toString() !== fg.toInts().toString())).toBe(expected.length > 1)
}

function frameLines(frame: string) {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
}
