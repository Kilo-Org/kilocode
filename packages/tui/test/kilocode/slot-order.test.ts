import { describe, expect, test } from "bun:test"
import { resolveSlots, type Claim } from "../../src/plugin/structure"

describe("slot order", () => {
  const claim = (key: string, order?: number): Claim<string> => ({
    key,
    plugin: key,
    placement: { kind: "append", target: "sidebar.content", order },
    render: key,
  })
  const keys = (claims: Claim<string>[]) =>
    resolveSlots({ paths: new Set(["sidebar.content"]), claims })
      .slotted.get("sidebar.content")
      ?.append.map((item) => item.key)

  test("without an order, claims keep enable order", () => {
    expect(keys([claim("context"), claim("mcp"), claim("todo")])).toEqual(["context", "mcp", "todo"])
  })

  test("Kilo sidebar orders sit between the upstream claims as on v1", () => {
    // Upstream claims count as 100, 200, 300 in enable order: context, mcp, todo.
    expect(
      keys([
        claim("context"),
        claim("mcp"),
        claim("todo"),
        claim("memory", 1000),
        claim("usage", 150),
        claim("processes", 250),
        claim("indexing", 225),
        claim("pr", 50),
      ]),
    ).toEqual(["pr", "context", "usage", "mcp", "indexing", "processes", "todo", "memory"])
  })

  test("the Kilo footer at 99 comes before the upstream footer", () => {
    const footer = (key: string, order?: number): Claim<string> => ({
      key,
      plugin: key,
      placement: { kind: "append", target: "sidebar.footer", order },
      render: key,
    })
    expect(
      resolveSlots({ paths: new Set(["sidebar.footer"]), claims: [footer("opencode"), footer("kilo", 99)] })
        .slotted.get("sidebar.footer")
        ?.append.map((item) => item.key),
    ).toEqual(["kilo", "opencode"])
  })
})
