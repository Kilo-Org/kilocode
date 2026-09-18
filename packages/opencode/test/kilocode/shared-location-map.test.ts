import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const root = new URL("../../src/", import.meta.url)

function source(path: string) {
  return readFileSync(new URL(path, root), "utf8")
}

describe("shared location service map", () => {
  test("server consumers do not build private location maps", () => {
    const files = [
      "server/routes/instance/httpapi/handlers/file.ts",
      "server/routes/instance/httpapi/handlers/pty.ts",
      "kilocode/server/reference-reconciler.ts",
    ]

    for (const file of files) {
      expect(source(file), file).not.toContain("locationServiceMapLayer")
    }
  })

  test("listener owns its location map scope", () => {
    expect(source("server/routes/instance/httpapi/server.ts")).toContain(
      "const locationServiceMapV2 = buildLocationServiceMap()",
    )
    expect(source("server/routes/instance/httpapi/server.ts")).not.toContain(
      "AppNodeBuilderV1.build(app, [[LocationServiceMap.node, locationServiceMapV2]])",
    )
    expect(source("effect/app-runtime.ts")).not.toContain("LocationServiceMap.node")
  })
})
