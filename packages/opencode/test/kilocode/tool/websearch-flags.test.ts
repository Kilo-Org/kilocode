import { describe, expect, test } from "bun:test"
import { webSearchFlags } from "../../../src/kilocode/tool/websearch"

describe("webSearchFlags", () => {
  test("uses runtime enableExa flag", () => {
    expect(webSearchFlags({ enableExa: true, enableParallel: false })).toEqual({
      exa: true,
      parallel: false,
    })
  })

  test("uses experimental.enable_exa config", () => {
    expect(
      webSearchFlags({ enableExa: false, enableParallel: false }, { experimental: { enable_exa: true } }),
    ).toEqual({
      exa: true,
      parallel: false,
    })
  })

  test("keeps parallel independent of exa config", () => {
    expect(
      webSearchFlags({ enableExa: false, enableParallel: true }, { experimental: { enable_exa: true } }),
    ).toEqual({
      exa: true,
      parallel: true,
    })
  })

  test("defaults to disabled without flags or config", () => {
    expect(webSearchFlags({ enableExa: false, enableParallel: false })).toEqual({
      exa: false,
      parallel: false,
    })
  })
})
