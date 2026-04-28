import { describe, it, expect, afterEach } from "bun:test"
import { buildKiloHeaders, getFeatureHeader, getEditorNameHeader, createKilo } from "@kilocode/kilo-gateway"
import { HEADER_FEATURE, ENV_FEATURE, ENV_VERSION, DEFAULT_EDITOR_NAME, ENV_EDITOR_NAME } from "@kilocode/kilo-gateway"

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
  const originalEditor = process.env[ENV_EDITOR_NAME]

  afterEach(() => {
    if (originalVersion === undefined) {
      delete process.env[ENV_VERSION]
    } else {
      process.env[ENV_VERSION] = originalVersion
    }
    if (originalEditor === undefined) {
      delete process.env[ENV_EDITOR_NAME]
    } else {
      process.env[ENV_EDITOR_NAME] = originalEditor
    }
  })

  it("returns default editor name without version when KILOCODE_VERSION is not set", () => {
    delete process.env[ENV_EDITOR_NAME]
    delete process.env[ENV_VERSION]
    expect(getEditorNameHeader()).toBe(DEFAULT_EDITOR_NAME)
  })

  it("appends version when KILOCODE_VERSION is set", () => {
    delete process.env[ENV_EDITOR_NAME]
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

describe("createKilo header merging", () => {
  const original = process.env[ENV_FEATURE]

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_FEATURE]
    } else {
      process.env[ENV_FEATURE] = original
    }
  })

  it("preserves explicit request feature headers", async () => {
    process.env[ENV_FEATURE] = "vscode-extension"

    const seen: string[] = []
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get(HEADER_FEATURE) ?? "")
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    const provider = createKilo({
      apiKey: "test",
      fetch: fetcher,
    })

    const model = provider.languageModel("anthropic/claude-sonnet-4") as unknown as {
      doGenerate(input: unknown): Promise<unknown>
    }
    await model
      .doGenerate({
        abortSignal: undefined,
        headers: { [HEADER_FEATURE]: "agent-manager" },
        mode: { type: "regular" },
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      })
      .catch(() => undefined)

    expect(seen[0]).toBe("agent-manager")
  })
})
