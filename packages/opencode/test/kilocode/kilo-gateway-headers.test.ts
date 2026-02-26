// kilocode_change - new file
import { describe, it, expect, afterEach } from "bun:test"
import { buildKiloHeaders, getFeatureHeader, getEditorNameHeader } from "@kilocode/kilo-gateway"
import {
  HEADER_FEATURE,
  ENV_FEATURE,
  ENV_EDITOR_NAME,
  ENV_EDITOR_VERSION,
  DEFAULT_EDITOR_NAME,
} from "@kilocode/kilo-gateway"

describe("getFeatureHeader", () => {
  const original = process.env[ENV_FEATURE]

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_FEATURE]
    } else {
      process.env[ENV_FEATURE] = original
    }
  })

  it("returns undefined when env var is not set", () => {
    delete process.env[ENV_FEATURE]
    expect(getFeatureHeader()).toBeUndefined()
  })

  it("returns the env var value when set", () => {
    process.env[ENV_FEATURE] = "cloud-agent"
    expect(getFeatureHeader()).toBe("cloud-agent")
  })

  it("returns undefined for empty string", () => {
    process.env[ENV_FEATURE] = ""
    expect(getFeatureHeader()).toBeUndefined()
  })
})

describe("getEditorNameHeader", () => {
  const originalName = process.env[ENV_EDITOR_NAME]
  const originalVersion = process.env[ENV_EDITOR_VERSION]

  afterEach(() => {
    if (originalName === undefined) {
      delete process.env[ENV_EDITOR_NAME]
    } else {
      process.env[ENV_EDITOR_NAME] = originalName
    }
    if (originalVersion === undefined) {
      delete process.env[ENV_EDITOR_VERSION]
    } else {
      process.env[ENV_EDITOR_VERSION] = originalVersion
    }
  })

  it("returns default editor name when no env vars set", () => {
    delete process.env[ENV_EDITOR_NAME]
    delete process.env[ENV_EDITOR_VERSION]
    expect(getEditorNameHeader()).toBe(DEFAULT_EDITOR_NAME)
  })

  it("appends version when KILOCODE_EDITOR_VERSION is set", () => {
    delete process.env[ENV_EDITOR_NAME]
    process.env[ENV_EDITOR_VERSION] = "1.2.3"
    expect(getEditorNameHeader()).toBe(`${DEFAULT_EDITOR_NAME}/1.2.3`)
  })

  it("uses custom editor name with version", () => {
    process.env[ENV_EDITOR_NAME] = "Visual Studio Code"
    process.env[ENV_EDITOR_VERSION] = "0.5.0"
    expect(getEditorNameHeader()).toBe("Visual Studio Code/0.5.0")
  })

  it("returns editor name without version when version is not set", () => {
    process.env[ENV_EDITOR_NAME] = "Visual Studio Code"
    delete process.env[ENV_EDITOR_VERSION]
    expect(getEditorNameHeader()).toBe("Visual Studio Code")
  })
})

describe("buildKiloHeaders", () => {
  const original = process.env[ENV_FEATURE]

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_FEATURE]
    } else {
      process.env[ENV_FEATURE] = original
    }
  })

  it("includes feature header when env var is set", () => {
    process.env[ENV_FEATURE] = "vscode-extension"
    const headers = buildKiloHeaders()
    expect(headers[HEADER_FEATURE]).toBe("vscode-extension")
  })

  it("omits feature header when env var is not set", () => {
    delete process.env[ENV_FEATURE]
    const headers = buildKiloHeaders()
    expect(headers[HEADER_FEATURE]).toBeUndefined()
  })

  it("always includes editor name header", () => {
    delete process.env[ENV_FEATURE]
    const headers = buildKiloHeaders()
    expect(headers["X-KILOCODE-EDITORNAME"]).toBe(getEditorNameHeader())
  })

  it("passes through any feature value from env", () => {
    process.env[ENV_FEATURE] = "custom-feature"
    const headers = buildKiloHeaders()
    expect(headers[HEADER_FEATURE]).toBe("custom-feature")
  })
})
