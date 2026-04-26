import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as path from "path"

const authHandlerPath = path.resolve(import.meta.dir, "../../src/kilo-provider/handlers/auth.ts")

describe("auth webview guard", () => {
  it("does not expose raw auth payload fields in auth-path webview messages", () => {
    const source = fs.readFileSync(authHandlerPath, "utf8")
    const messageBlocks = [...source.matchAll(/postMessage\(\{([\s\S]*?)\}\)/g)].map((match) => match[1] ?? "")

    expect(messageBlocks.length).toBeGreaterThan(0)
    for (const block of messageBlocks) {
      expect(block).not.toContain("refresh")
      expect(block).not.toContain("access")
      expect(block).not.toContain("KILO_AUTH_CONTENT")
      expect(block).not.toContain("readSecret")
    }
  })
})
