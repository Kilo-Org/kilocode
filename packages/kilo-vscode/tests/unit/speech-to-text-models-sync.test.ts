import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_SPEECH_TO_TEXT_MODEL, SPEECH_TO_TEXT_MODELS } from "../../src/speech-to-text/models"

describe("speech-to-text model settings", () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))
  const prop = pkg.contributes.configuration.properties["kilo-code.new.speechToText.model"]

  it("keeps the default model in code instead of duplicating it in package.json", () => {
    expect(prop.default).toBeUndefined()
    expect(DEFAULT_SPEECH_TO_TEXT_MODEL.id).toBe(SPEECH_TO_TEXT_MODELS[0]?.id)
  })

  it("keeps the selectable model list out of package.json", () => {
    expect(prop.enum).toBeUndefined()
    expect(prop.enumDescriptions).toBeUndefined()
  })
})
