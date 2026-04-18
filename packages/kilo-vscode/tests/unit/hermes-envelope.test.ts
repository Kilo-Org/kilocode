import { describe, expect, it } from "bun:test"
import { buildEnvelope } from "../../src/services/hermes/HermesPipeline"
import {
  HERMES_DEFAULT_BASE_URL,
  HERMES_ENV_FALLBACKS,
  HERMES_SECRET_KEY,
} from "../../src/services/hermes/types"
import { buildPreset, HERMES_PROVIDER_ID } from "../../src/services/hermes/HermesProviderPreset"

describe("buildEnvelope", () => {
  it("produces a well-formed envelope with workspace-only scope", () => {
    const env = buildEnvelope(
      { intent: "refactor foo", requiresExecution: true },
      "/workspace/proj",
      "auto-low",
      true,
    )
    expect(env.origin).toBe("kilocode")
    expect(env.project_path).toBe("/workspace/proj")
    expect(env.requires_execution).toBe(true)
    expect(env.approval_mode).toBe("auto-low")
    expect(env.constraints.workspace_scope).toEqual(["/workspace/proj"])
    expect(env.constraints.allow_network).toBe(false)
    expect(env.constraints.allow_write).toBe(true)
    expect(env.task_id).toMatch(/^task-[a-z0-9]+-[a-z0-9]+$/)
    expect(env.metadata.submitter).toBe("kilo-vscode")
  })

  it("honours approval override", () => {
    const env = buildEnvelope(
      { intent: "x", requiresExecution: false, approvalMode: "manual" },
      "/p",
      "auto-low",
      true,
    )
    expect(env.approval_mode).toBe("manual")
  })

  it("adds extra scope paths", () => {
    const env = buildEnvelope(
      { intent: "x", requiresExecution: true, extraScope: ["/extra"] },
      "/p",
      "auto-low",
      true,
    )
    expect(env.constraints.workspace_scope).toEqual(["/p", "/extra"])
  })

  it("when workspaceScopeOnly=false, uses only extraScope", () => {
    const env = buildEnvelope(
      { intent: "x", requiresExecution: true, extraScope: ["/a", "/b"] },
      "/p",
      "auto-low",
      false,
    )
    expect(env.constraints.workspace_scope).toEqual(["/a", "/b"])
  })

  it("falls back to project when extraScope is empty and scope-only is off", () => {
    const env = buildEnvelope(
      { intent: "x", requiresExecution: true },
      "/p",
      "auto-low",
      false,
    )
    expect(env.constraints.workspace_scope).toEqual(["/p"])
  })

  it("generates unique task ids per call", () => {
    const a = buildEnvelope({ intent: "x", requiresExecution: false }, "/p", "auto-low", true)
    const b = buildEnvelope({ intent: "x", requiresExecution: false }, "/p", "auto-low", true)
    expect(a.task_id).not.toBe(b.task_id)
  })
})

describe("buildPreset", () => {
  it("produces an OpenAI-compatible provider config pointing at the Hermes bridge", () => {
    const p = buildPreset("http://localhost:18789")
    expect(p.name).toBe("Hermes")
    expect(p.npm).toBe("@ai-sdk/openai-compatible")
    expect(p.options.baseURL).toBe("http://localhost:18789/v1")
    expect(p.env).toEqual([HERMES_SECRET_KEY])
    expect(p.options.headers["x-kilo-source"]).toBe("kilo-vscode")
    expect(Object.keys(p.models).length).toBeGreaterThan(0)
  })

  it("strips trailing slashes before appending /v1", () => {
    const p = buildPreset("http://example.com:8080/")
    expect(p.options.baseURL).toBe("http://example.com:8080/v1")
  })

  it("defaults to shiba-piggyback URL when none given", () => {
    const p = buildPreset()
    expect(p.options.baseURL).toBe(`${HERMES_DEFAULT_BASE_URL}/v1`)
  })
})

describe("hermes constants", () => {
  it("provider id is stable", () => {
    expect(HERMES_PROVIDER_ID).toBe("hermes")
  })

  it("env fallback chain is ordered and non-empty", () => {
    expect(HERMES_ENV_FALLBACKS.length).toBeGreaterThanOrEqual(1)
    expect(HERMES_ENV_FALLBACKS[0]).toBe("HERMES_API_KEY")
  })

  it("default base url is http", () => {
    const url: string = HERMES_DEFAULT_BASE_URL
    expect(url.startsWith("http")).toBe(true)
  })
})
