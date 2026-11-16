import { expect, test } from "bun:test"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloBranding } from "../src/branding/text"
import { compileDefine } from "./fixtures/compile-define"
import { checkEpilogue, repo, run, temporary } from "./fixtures/branding-run"

for (const hosted of [false, true]) {
  for (const columns of [0, 44, 48, 52, 53, 55, 56, 72, 120]) {
    test(`source epilogue: ${hosted ? "Kilo" : "upstream"}, ${columns} columns`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/epilogue.ts")
      checkEpilogue(await run([process.execPath, fixture, String(columns)], root.path, hosted), hosted, columns)
    }, 60_000)
  }

  test(`compiled epilogue: ${hosted ? "Kilo" : "upstream"}, 48 columns`, async () => {
    await using root = await temporary()
    const outfile = path.join(root.path, process.platform === "win32" ? "epilogue.exe" : "epilogue")
    const result = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "fixtures/epilogue.ts")],
      plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin()],
      compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
      define: compileDefine,
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
    }, 60_000)
  }
}

test("source/compiled epilogue anchors are applied", async () => {
  const filename = path.join(repo, "packages/tui/src/util/presentation.ts")
  const source = KiloBranding.transform(filename, await Bun.file(filename).text())
  expect(source).toContain("widths.full + pad.length")
})
