import { describe, expect, test } from "bun:test"
import { keepRecord, webSearchEnabled, webSearchSelection } from "../webview-ui/src/components/settings/settings-values"

describe("webSearchSelection", () => {
  test("maps on to the random pseudo-provider and off to false", () => {
    expect(webSearchSelection(true)).toEqual({ provider: "random" })
    expect(webSearchSelection(false)).toBe(false)
  })
})

describe("webSearchEnabled", () => {
  test("is on for a provider selection and off for false or unset", () => {
    expect(webSearchEnabled({ provider: "random" })).toBe(true)
    expect(webSearchEnabled({ provider: "exa" })).toBe(true)
    expect(webSearchEnabled(false)).toBe(false)
    expect(webSearchEnabled(undefined)).toBe(false)
  })
})

describe("keepRecord", () => {
  test("keeps an existing record when it stays on", () => {
    const record = { eslint: { command: ["eslint"] } }
    expect(keepRecord(record, true)).toBe(record)
  })

  test("falls back to the empty record when on without a record", () => {
    expect(keepRecord(undefined, true)).toEqual({})
    expect(keepRecord(true, true)).toEqual({})
    expect(keepRecord(false, true)).toEqual({})
  })

  test("writes false when it turns off", () => {
    expect(keepRecord({ eslint: {} }, false)).toBe(false)
  })
})
