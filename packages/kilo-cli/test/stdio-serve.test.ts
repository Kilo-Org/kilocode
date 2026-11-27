import { describe, expect, test } from "bun:test"
import { parseStdioServeArgs } from "../src/stdio-serve"

describe("parseStdioServeArgs", () => {
  test("accepts standard extension stdio serve invocation", () => {
    expect(parseStdioServeArgs(["serve", "--port", "0", "--stdio"])).toEqual({
      port: 0,
      hostname: undefined,
      cors: undefined,
    })
  })

  test("parses equals-style flags, hostname, and multiple cors entries", () => {
    expect(
      parseStdioServeArgs([
        "serve",
        "--stdio",
        "--port=4321",
        "--hostname",
        "127.0.0.1",
        "--cors",
        "http://localhost:3000",
        "--cors=http://localhost:5173",
      ]),
    ).toEqual({
      port: 4321,
      hostname: "127.0.0.1",
      cors: ["http://localhost:3000", "http://localhost:5173"],
    })
  })

  test("falls back to full CLI parser for non-stdio, help, service, or unknown flags", () => {
    expect(parseStdioServeArgs(["serve", "--port", "0"])).toBeUndefined()
    expect(parseStdioServeArgs(["serve", "--stdio", "--service"])).toBeUndefined()
    expect(parseStdioServeArgs(["serve", "--stdio", "--help"])).toBeUndefined()
    expect(parseStdioServeArgs(["serve", "--stdio", "--unknown"])).toBeUndefined()
    expect(parseStdioServeArgs(["serve", "--stdio", "--port", "abc"])).toBeUndefined()
    expect(parseStdioServeArgs(["run", "--stdio"])).toBeUndefined()
    expect(parseStdioServeArgs([])).toBeUndefined()
  })
})
