import { expect, test } from "bun:test"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { createPluginRuntimePlugin } from "../script/plugin-runtime"
import { compileDefine } from "./fixtures/compile-define"
import { checkEpilogue, run, temporary } from "./fixtures/branding-run"

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
      define: compileDefine,
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
