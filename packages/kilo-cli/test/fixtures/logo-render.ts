declare const KILO_BRANDING_COMPILED: boolean

process.env.KILO_UNICODE_LOGO = process.argv[2] ?? "0"

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { testRender } = await import("@opentui/solid")
const { createComponent } = await import("solid-js")
const { ConfigProvider, resolve } = await import("../../../tui/src/config")
const { ThemeProvider } = await import("../../../tui/src/context/theme")
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
    let ready = false
    const app = await testRender(
      () =>
        createComponent(ConfigProvider, {
          config: resolve({ theme: { mode } }, { terminalSuspend: false, environment: {} }),
          get children() {
            return createComponent(ThemeProvider, {
              mode,
              source: { discover: async () => ({}) },
              get children() {
                ready = true
                return createComponent(Logo, {})
              },
            })
          },
        }),
      { width, height },
    )
    try {
      await app.waitForFrame(() => ready, { maxPasses: 20 })
      await app.renderOnce()
      frames.push({
        width,
        height,
        mode,
        frame: app.captureCharFrame(),
        spans: app
          .captureSpans()
          .lines.flatMap((line) =>
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
    } finally {
      app.renderer.destroy()
    }
  }
}

console.log(JSON.stringify({ frames, assets }))
