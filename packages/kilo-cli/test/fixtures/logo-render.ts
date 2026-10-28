declare const KILO_BRANDING_COMPILED: boolean

process.env.KILO_UNICODE_LOGO = process.argv[2] ?? "0"

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { testRender } = await import("@opentui/solid")
const { createComponent } = await import("solid-js")
const { ConfigProvider, resolve } = await import("../../../tui/src/config")
const { ThemeProvider, useThemes } = await import("../../../tui/src/context/theme")
const { Logo } = await import("../../../tui/src/component/logo")
const assets = await import("../../../tui/src/logo")
const frames: {
  width: number
  height: number
  mode: "dark" | "light"
  frame: string
  spans: { text: string; fg: number[]; bg: number[]; attributes: number }[]
}[] = []

for (const mode of ["dark", "light"] as const) {
  for (const [width, height] of [
    [80, 30],
    [58, 30],
    [57, 30],
    [30, 30],
    [29, 30],
    [12, 30],
    [80, 10],
  ]) {
    let themes: ReturnType<typeof useThemes> | undefined
    const app = await testRender(
      () =>
        createComponent(ConfigProvider, {
          config: resolve({}, { terminalSuspend: false, environment: {} }),
          get children() {
            return createComponent(ThemeProvider, {
              mode,
              source: { discover: async () => ({}) },
              get children() {
                themes = useThemes()
                return createComponent(Logo, {})
              },
            })
          },
        }),
      { width, height },
    )
    try {
      await app.waitForFrame(() => themes !== undefined, { maxPasses: 20 })
      for (const current of [mode, mode === "dark" ? "light" : "dark", mode] as const) {
        if (!themes?.setMode(current, false)) throw new Error(`Cannot switch logo theme to ${current}`)
        await app.flush()
        await app.renderOnce()
        if (themes.mode() !== current) throw new Error(`Logo theme stayed ${themes.mode()} instead of ${current}`)
        frames.push({
          width,
          height,
          mode: current,
          frame: app.captureCharFrame(),
          spans: app.captureSpans().lines.flatMap((line) =>
            line.spans
              .filter((span) => span.text.trim())
              .map((span) => ({
                text: span.text,
                fg: span.fg.toInts(),
                bg: span.bg.toInts(),
                attributes: span.attributes,
              })),
          ),
        })
      }
    } finally {
      app.renderer.destroy()
    }
  }
}

console.log(JSON.stringify({ frames, assets }))
