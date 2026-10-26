import type { Context } from "@opencode/plugin/tui/context"

declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { RGBA } = await import("@opentui/core")
const { testRender } = await import("@opentui/solid")
const { SidebarOnboarding } = await import("../../../tui/src/feature-plugins/sidebar/footer")
const color = RGBA.fromInts(200, 200, 200)
const location = { directory: "/workspace" }
const context = {
  location,
  theme: {
    background: { raised: { high: color } },
    text: { base: color, muted: color },
  },
  storage: { store: () => [{ dismissed: false }, async () => {}] },
  data: {
    session: { get: () => ({ location }) },
    location: { integration: { list: () => [] } },
  },
  keymap: { dispatch: () => {} },
} as unknown as Context

const app = await testRender(() => SidebarOnboarding({ context, sessionID: "session" }), { width: 80, height: 24 })
try {
  await app.renderOnce()
  console.log(JSON.stringify(app.captureCharFrame()))
} finally {
  app.renderer.destroy()
}
