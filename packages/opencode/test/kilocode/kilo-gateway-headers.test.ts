import { describe, it, expect, afterEach } from "bun:test"
import { buildKiloHeaders, getFeatureHeader, getEditorNameHeader } from "@kilocode/kilo-gateway"
import { HEADER_FEATURE, ENV_FEATURE, ENV_VERSION, DEFAULT_EDITOR_NAME } from "@kilocode/kilo-gateway"

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
  const originalVersion = process.env[ENV_VERSION]

  afterEach(() => {
    if (originalVersion === undefined) {
      delete process.env[ENV_VERSION]
    } else {
      process.env[ENV_VERSION] = originalVersion
    }
  })

  it("returns default editor name without version when KILOCODE_VERSION is not set", () => {
    delete process.env[ENV_VERSION]
    expect(getEditorNameHeader()).toBe(DEFAULT_EDITOR_NAME)
  })

  it("appends version when KILOCODE_VERSION is set", () => {
    process.env[ENV_VERSION] = "1.2.3"
    expect(getEditorNameHeader()).toBe(`${DEFAULT_EDITOR_NAME} 1.2.3`)
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
