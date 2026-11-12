import { describe, expect, test } from "bun:test"
import {
  imageGenerationEnabled,
  imageGenerationModel,
  imageGenerationSwitch,
  keepRecord,
  webSearchEnabled,
  webSearchSelection,
} from "../webview-ui/src/components/settings/settings-values"

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

describe("imageGenerationEnabled", () => {
  test("is on only for true or a model value, and off for unset or false", () => {
    expect(imageGenerationEnabled(undefined)).toBe(false)
    expect(imageGenerationEnabled(true)).toBe(true)
    expect(imageGenerationEnabled({ model: { providerID: "openai", model: "gpt-image-2" } })).toBe(true)
    expect(imageGenerationEnabled(false)).toBe(false)
  })
})

describe("imageGenerationSwitch", () => {
  test("writes false when it turns off", () => {
    expect(imageGenerationSwitch({ model: { providerID: "openai", model: "gpt-image-2" } }, false)).toBe(false)
  })

  test("keeps a configured model when it turns on", () => {
    const value = { model: { providerID: "openai", model: "gpt-image-2" } }
    expect(imageGenerationSwitch(value, true)).toBe(value)
  })

  test("writes true when it turns on without a configured model", () => {
    expect(imageGenerationSwitch(undefined, true)).toBe(true)
    expect(imageGenerationSwitch(true, true)).toBe(true)
    expect(imageGenerationSwitch(false, true)).toBe(true)
  })
})

describe("imageGenerationModel", () => {
  test("writes the picked model and keeps the tool on", () => {
    expect(imageGenerationModel(true, { providerID: "openai", model: "gpt-image-2", variant: "hd" })).toEqual({
      model: { providerID: "openai", model: "gpt-image-2", variant: "hd" },
    })
  })

  test("drops the model on clear but keeps the tool on", () => {
    expect(imageGenerationModel({ model: { providerID: "openai", model: "gpt-image-2" } }, undefined)).toEqual({})
  })

  test("keeps the other keys of the setting", () => {
    const value = { model: { providerID: "openai", model: "gpt-image-2" }, future: true }
    expect(imageGenerationModel(value, undefined)).toEqual({ future: true })
  })
})
