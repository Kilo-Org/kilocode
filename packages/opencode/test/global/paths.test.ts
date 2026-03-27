import { describe, expect, test } from "bun:test"
import path from "path"
import { expandHomePattern, resolveGlobalPaths } from "../../src/global/paths"

describe("resolveGlobalPaths", () => {
  test("builds Windows config path with separator before .config", () => {
    const result = resolveGlobalPaths("kilo", {
      home: "C:\\Users\\user1",
      env: {},
      pathmod: path.win32,
    })

    expect(result.config).toBe("C:\\Users\\user1\\.config\\kilo")
    expect(result.data).toBe("C:\\Users\\user1\\.local\\share\\kilo")
    expect(result.state).toBe("C:\\Users\\user1\\.local\\state\\kilo")
  })

  test("prefers XDG_CONFIG_HOME when provided", () => {
    const result = resolveGlobalPaths("kilo", {
      home: "C:\\Users\\user1",
      env: {
        config: "D:\\config-root",
      },
      pathmod: path.win32,
    })

    expect(result.config).toBe("D:\\config-root\\kilo")
  })
})

describe("expandHomePattern", () => {
  test("expands tilde paths with Windows separators", () => {
    const result = expandHomePattern("~/agent/rules.md", "C:\\Users\\user1", path.win32)
    expect(result).toBe("C:\\Users\\user1\\agent\\rules.md")
  })

  test("expands $HOME paths with Windows separators", () => {
    const result = expandHomePattern("$HOME/agent/rules.md", "C:\\Users\\user1", path.win32)
    expect(result).toBe("C:\\Users\\user1\\agent\\rules.md")
  })
})
