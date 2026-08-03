import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const css = readFileSync(resolve(import.meta.dir, "../../webview-ui/agent-manager/agent-manager.css"), "utf8")

test("xterm owns the padding used by FitAddon", () => {
  const host = css.match(/\.am-terminal-host\s*\{([^}]*)\}/)?.[1]
  const term = css.match(/\.am-terminal-host \[class~="xterm"\]\s*\{([^}]*)\}/)?.[1]

  expect(host).toBeDefined()
  expect(term).toBeDefined()
  expect(host).not.toMatch(/\bpadding\s*:/)
  expect(term).toMatch(/\bpadding\s*:\s*8px\s*;/)
})
