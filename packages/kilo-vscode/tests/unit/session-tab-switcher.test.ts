import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const ROOT = path.resolve(import.meta.dir, "../..")
const WEBVIEW = path.join(ROOT, "webview-ui")
const FIXTURE = path.join(ROOT, "tests/fixtures/session-tab-switcher.tsx")

describe("SessionTabSwitcher", () => {
  it("preserves filtering and restores focus across tab actions", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", WEBVIEW))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const dedupe = {
      name: "solid-dedupe",
      setup(ctx: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
        ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
      },
    }
    const result = await build({
      entryPoints: [FIXTURE],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      logLevel: "silent",
      platform: "node",
      plugins: [dedupe, solidPlugin()],
      target: "es2022",
      write: false,
    })
    const file = path.join(ROOT, `.session-tab-switcher-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    const child = Bun.spawnSync(["bun", file], { cwd: WEBVIEW, stdout: "pipe", stderr: "pipe" })
    unlinkSync(file)

    const output = child.stdout.toString() + child.stderr.toString()
    expect(child.exitCode, output).toBe(0)
  })

  it("uses logical properties for RTL layout", async () => {
    const css = await Bun.file(path.join(WEBVIEW, "src/styles/session-tabs.css")).text()
    const start = css.indexOf(".session-tab-switcher-wrap")
    const end = css.indexOf("/* Match tab context menus", start)
    const switcher = css.slice(start, end)

    expect(switcher).toContain("border-inline-start")
    expect(switcher).toContain("inset-inline-end")
    expect(switcher).toContain("padding-inline")
    expect(switcher).not.toMatch(/\b(?:left|right|margin-left|margin-right|border-left|border-right)\s*:/)
  })
})
