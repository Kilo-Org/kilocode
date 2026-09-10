import { expect, test } from "bun:test"
import manifest from "../package.json"

test("default launch contributes the original Kilo UI and builds its provider", async () => {
  expect(manifest.main).toBe("./dist/extension.cjs")
  expect(manifest.contributes.views["kilo-code-ActivityBar"]).toEqual([
    { type: "webview", id: "kilo-code.SidebarProvider", name: "Kilo Code" },
  ])
  expect(JSON.stringify(manifest.contributes)).not.toContain("kilo2.chat")
  const entry = await Bun.file(new URL("../src/extension.ts", import.meta.url)).text()
  expect(entry).toContain('import { KiloProvider } from "./KiloProvider"')
  expect(entry).not.toContain("connectedHtml")
  const build = await Bun.file(new URL("../script/build.ts", import.meta.url)).text()
  expect(build).toContain("src/extension.ts")
  expect(build).toContain("script/build-existing-web.ts")
  expect(await Bun.file(new URL("../web/index.tsx", import.meta.url)).exists()).toBe(false)
})
