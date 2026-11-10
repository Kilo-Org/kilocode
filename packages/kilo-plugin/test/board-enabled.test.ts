import { describe, expect, test } from "bun:test"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { BoardEnabled } from "../src/board/enabled"

const document = (shared_agent_board?: boolean) =>
  new Document({ type: "document", info: new KiloConfigPolicy.Info({ shared_agent_board }) })

describe("shared agent board enablement", () => {
  test("is enabled by default", () => {
    expect(BoardEnabled.resolve({})).toBe(true)
    expect(BoardEnabled.config([])).toBeUndefined()
  })

  test("follows the config key, the last document that sets it winning", () => {
    expect(BoardEnabled.resolve({ config: true })).toBe(true)
    expect(BoardEnabled.resolve({ config: false })).toBe(false)
    expect(BoardEnabled.config([document(false), document(undefined)])).toBe(false)
    expect(BoardEnabled.config([document(false), document(true)])).toBe(true)
  })

  test("reads the environment opt-out as a boolean", () => {
    expect(BoardEnabled.flag(undefined)).toBeUndefined()
    expect(BoardEnabled.flag("true")).toBe(true)
    expect(BoardEnabled.flag("false")).toBe(false)
    expect(BoardEnabled.flag(" OFF ")).toBe(false)
    expect(BoardEnabled.flag("maybe")).toBeUndefined()
  })

  test("lets either opt-out win over an explicit enable", () => {
    expect(BoardEnabled.resolve({ config: true, flag: false })).toBe(false)
    expect(BoardEnabled.resolve({ config: false, flag: true })).toBe(false)
    expect(BoardEnabled.resolve({ flag: true })).toBe(true)
  })
})
