import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { ConsoleAssets } from "../../src/kilocode/console/assets"

const original = process.env.KILO_CONSOLE_ASSET_DIR

afterEach(() => {
  if (original === undefined) delete process.env.KILO_CONSOLE_ASSET_DIR
  else process.env.KILO_CONSOLE_ASSET_DIR = original
})

async function assets(dir: string) {
  await mkdir(path.join(dir, "assets"), { recursive: true })
  await Bun.write(path.join(dir, "index.html"), '<!doctype html><html><body><div id="root">console</div></body></html>')
  await Bun.write(path.join(dir, "assets", "app.js"), "console.log('kilo')")
}

describe("Kilo Console UI routes", () => {
  test("serves the console index for /console and SPA routes", async () => {
    await using tmp = await tmpdir()
    process.env.KILO_CONSOLE_ASSET_DIR = tmp.path
    await assets(tmp.path)

    const root = await ConsoleAssets.resolve("/console")
    expect(root && "file" in root).toBe(true)
    if (!root || !("file" in root)) return
    expect(await Bun.file(root.file).text()).toContain("console")

    const route = await ConsoleAssets.resolve("/console/projects/demo")
    expect(route && "file" in route).toBe(true)
    if (!route || !("file" in route)) return
    expect(await Bun.file(route.file).text()).toContain("console")
  })

  test("serves console assets without falling back on missing files", async () => {
    await using tmp = await tmpdir()
    process.env.KILO_CONSOLE_ASSET_DIR = tmp.path
    await assets(tmp.path)

    const asset = await ConsoleAssets.resolve("/console/assets/app.js")
    expect(asset && "file" in asset).toBe(true)
    if (!asset || !("file" in asset)) return
    expect(await Bun.file(asset.file).text()).toContain("kilo")

    expect(await ConsoleAssets.resolve("/console/assets/missing.js")).toEqual({ missing: true })
  })
})
