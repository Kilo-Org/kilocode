import assert from "node:assert/strict"
import path from "node:path"
import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import kilo from "../../src/theme.json"

declare const KILO_BRANDING_COMPILED: boolean

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { Config } = await import("@opencode/cli/config/index")
const { KiloTheme } = await import("../../src/theme")
const { RGBA } = await import("@opentui/core")
const { resolveThemeDocument } = await import("../../../theme/src/tui")
const { allThemes, getOpenCodeTheme, parseTheme } = await import("../../../tui/src/theme")
const { resolve } = await import("../../../tui/src/config")
const { resolveRunTheme } = await import("../../../tui/src/mini/theme")
const { mount } = await import("./theme-view")
const hosted = process.env.KILO_THEME_TEST_HOSTED === "1"
const results = []

assert.equal("kilo" in allThemes(), hosted)

for (const scenario of ["default", "opencode", "unknown", "invalid", "custom"]) {
  const directory = path.join(process.env.XDG_CONFIG_HOME!, scenario)
  const selected = scenario === "default" ? undefined : scenario === "custom" ? "kilo" : scenario
  await Bun.write(path.join(directory, "cli.json"), JSON.stringify(selected ? { theme: { name: selected } } : {}))
  const service = await Effect.runPromise(
    Config.Service.pipe(
      Effect.provide(hosted ? KiloTheme.layer : Config.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
  const get = () => Effect.runPromise(service.get())
  const initial = await get()
  const custom = { ...kilo, theme: { ...kilo.theme, text: { dark: "#123456", light: "#654321" } } }
  const source = scenario === "custom" ? custom : scenario === "default" && hosted ? kilo : getOpenCodeTheme()
  const view = await mount(
    resolve(initial, { terminalSuspend: true, environment: {} }),
    {
      path: service.path,
      get,
      update: (update) => Effect.runPromise(service.update(update)),
    },
    { discover: async () => (scenario === "custom" ? { kilo: custom } : { invalid: { base: "not-a-theme" } }) },
  )
  const errors: string[] = []
  const unsubscribe = view.themes.onError((event) => errors.push(event.name))
  try {
    const modes = []
    for (const mode of ["dark", "light", "dark"] as const) {
      assert.equal(view.themes.setMode(mode, false), true)
      await view.app.renderOnce()
      assert.equal(view.themes.mode(), mode)
      const expected = resolveThemeDocument(parseTheme(source, scenario), mode)
      const tokens = view.themes.currentTokens()
      assert.deepEqual(colors(tokens), colors(expected))
      const spans = view.app.captureSpans().lines.flatMap((line) => line.spans)
      for (const [label, fg, bg] of [
        ["Theme text", expected.text.base, expected.background.base],
        ["Primary action", expected.text.action.primary.base, expected.background.action.primary.base],
        ["Selected field", expected.text.formfield.selected, expected.background.formfield.selected],
        ["Error feedback", expected.text.feedback.error.base, expected.background.base],
        ["Markdown link", expected.markdown.link, expected.background.base],
      ] as const) {
        const span = spans.find((span) => span.text.includes(label))
        assert.ok(span, `Missing rendered span: ${label}`)
        assert.deepEqual(span.fg.toInts(), fg.toInts(), `${scenario}/${mode}/${label} foreground`)
        assert.deepEqual(
          span.bg.toInts(),
          (bg.a === 0 ? expected.background.base : bg).toInts(),
          `${scenario}/${mode}/${label} background`,
        )
      }
      if (scenario === "default" || scenario === "opencode") {
        const mini = await resolveRunTheme(view.app.renderer, { ...initial.theme, mode })
        assert.ok(mini.footer.text instanceof RGBA)
        assert.deepEqual(mini.footer.text.toInts(), expected.text.base.toInts())
        assert.ok(mini.footer.link instanceof RGBA)
        assert.deepEqual(mini.footer.link.toInts(), expected.markdown.link.toInts())
        mini.block.syntax?.destroy()
      }
      modes.push({ mode, text: tokens.text.base.toInts(), action: tokens.text.action.primary.base.toInts() })
    }
    assert.equal(view.themes.has("kilo"), hosted || scenario === "custom")
    if (scenario === "invalid") assert.deepEqual(errors, ["invalid"])
    const active = view.themes.selected
    if (scenario === "default") {
      assert.equal(active, hosted ? "kilo" : "opencode")
      assert.equal(view.themes.set("missing-theme"), false)
      assert.equal(view.themes.selected, active)
      assert.equal(view.themes.set("dracula"), true)
      await view.app.waitForFrame(() => view.settings.data.theme?.name === "dracula")
      assert.equal((await Bun.file(service.path).json()).theme.name, "dracula")
      assert.equal(view.themes.set(active), true)
      await view.app.waitForFrame(() => view.settings.data.theme?.name === active)
      assert.equal((await Bun.file(service.path).json()).theme.name, active)
      assert.equal((await get()).theme?.name, active)
      await view.app.renderOnce()
      assert.deepEqual(colors(view.themes.currentTokens()), colors(resolveThemeDocument(parseTheme(source), "dark")))
    }
    results.push({ scenario, active, modes, errors, registry: Object.keys(view.themes.all()) })
  } finally {
    unsubscribe()
    view.app.renderer.destroy()
  }
}

console.log(JSON.stringify({ hosted, results }))

function colors(value: unknown): unknown {
  if (value instanceof RGBA) return value.toInts()
  if (Array.isArray(value)) return value.map(colors)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, value]) => typeof value !== "function")
      .map(([key, value]) => [key, colors(value)]),
  )
}
