import { describe, expect, it } from "bun:test"
import { splitConfigByScope } from "../../webview-ui/src/utils/config-scope"

describe("splitConfigByScope", () => {
  it("writes indexing enablement to project config only", () => {
    const split = splitConfigByScope({
      indexing: {
        enabled: true,
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({ indexing: { enabled: true } })
  })

  it("writes indexing provider settings to global config", () => {
    const split = splitConfigByScope({
      indexing: {
        provider: "ollama",
      },
    })

    expect(split.global).toEqual({ indexing: { provider: "ollama" } })
    expect(split.project).toEqual({})
  })

  it("can write indexing enablement to global config through a global draft", () => {
    const split = splitConfigByScope({ username: "marius" })
    const draft = { indexing: { enabled: true } }

    expect({ ...split.global, ...draft }).toEqual({ username: "marius", indexing: { enabled: true } })
    expect(split.project).toEqual({})
  })
})
