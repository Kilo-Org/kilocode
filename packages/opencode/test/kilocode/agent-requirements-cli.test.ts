import { describe, expect, test } from "bun:test"
import type { AgentRequirementResult } from "@kilocode/sdk/v2"
import { formatError as formatStreamError } from "@/cli/cmd/run/session-data"
import * as Requirements from "@/kilocode/cli/agent-requirements"

const dir = "/tmp/agent-requirements-cli"

function result(input: Partial<AgentRequirementResult> = {}): AgentRequirementResult {
  return {
    agent: "demo",
    directory: dir,
    enabled: true,
    state: "ready",
    skills: [],
    mcps: [],
    vscode_extensions: [],
    ...input,
  }
}

function client(value: AgentRequirementResult): Requirements.Client {
  return {
    kilocode: {
      agentRequirements: async (parameters, options) => {
        expect(parameters).toEqual({ agent: value.agent, directory: value.directory })
        expect(options).toEqual({ throwOnError: true })
        return { data: value }
      },
    },
  }
}

async function check(value: AgentRequirementResult) {
  return Requirements.check({ client: client(value), agent: value.agent, directory: value.directory })
}

describe("CLI agent requirements", () => {
  test("allows disabled requirements", async () => {
    const output = await check(result({ enabled: false, state: "disabled" }))

    expect(output.ok).toBe(true)
  })

  test("allows ready requirements", async () => {
    const output = await check(
      result({
        skills: [{ name: "ready-skill", status: "ready" }],
        mcps: [{ name: "ready-mcp", status: "ready" }],
      }),
    )

    expect(output.ok).toBe(true)
  })

  test("blocks missing skills", async () => {
    const output = await check(
      result({
        state: "blocked",
        skills: [
          { name: "ready-skill", status: "ready" },
          { name: "missing-skill", status: "missing" },
        ],
      }),
    )

    expect(output.ok).toBe(false)
    if (output.ok) return
    expect(output.error).toMatchObject({
      name: "AgentRequirementError",
      data: { agent: "demo", state: "blocked" },
    })
    expect(output.error.data.skills).toContainEqual({ name: "missing-skill", status: "missing" })
  })

  test("blocks missing and error MCPs", async () => {
    const output = await check(
      result({
        state: "blocked",
        mcps: [
          { name: "missing-mcp", status: "missing" },
          { name: "error-mcp", status: "error", message: "server crashed" },
        ],
      }),
    )

    expect(output.ok).toBe(false)
    if (output.ok) return
    expect(output.error.data.mcps).toEqual([
      { name: "missing-mcp", status: "missing" },
      { name: "error-mcp", status: "error", message: "server crashed" },
    ])
  })

  test("blocks VS Code extension declarations", async () => {
    const output = await check(
      result({
        vscode_extensions: [{ name: "Sample Extension", id: "publisher.extension" }],
      }),
    )

    expect(output.ok).toBe(false)
    if (output.ok) return
    expect(output.error.data.state).toBe("blocked")
    expect(output.error.data.vscode_extensions).toEqual([{ name: "Sample Extension", id: "publisher.extension" }])
    const text = Requirements.format(output.error)
    expect(text).toContain("Use the Kilo VS Code extension instead")
    expect(text).not.toContain("Install the required skills and configure or connect the required MCP servers")
  })

  test("formats grouped actionable guidance", () => {
    const text = Requirements.format(
      Requirements.toError(
        result({
          state: "error",
          error: { code: "discovery_failed", message: "skill scan failed" },
          skills: [
            { name: "ready-skill", status: "ready" },
            { name: "missing-skill", status: "missing" },
            { name: "error-skill", status: "error", message: "skill scan failed" },
          ],
          mcps: [
            { name: "missing-mcp", status: "missing" },
            { name: "error-mcp", status: "error", message: "auth failed" },
          ],
          vscode_extensions: [{ name: "Sample Extension", id: "publisher.extension" }],
        }),
      ),
    )

    expect(text).toContain('Agent requirements are not met for "demo".')
    expect(text).toContain("VS Code extensions:")
    expect(text).toContain("Sample Extension (publisher.extension)")
    expect(text).toContain("Skills:")
    expect(text).toContain("missing-skill (missing)")
    expect(text).toContain("error-skill (error: skill scan failed)")
    expect(text).not.toContain("ready-skill (ready)")
    expect(text).toContain("MCP servers:")
    expect(text).toContain("missing-mcp (missing)")
    expect(text).toContain("error-mcp (error: auth failed)")
    expect(text).toContain("Install the required skills and configure or connect the required MCP servers, then retry.")
  })

  test("recognizes AgentRequirementError objects", () => {
    const error = Requirements.toError(result({ state: "blocked" }))

    expect(Requirements.data(error)).toEqual(error.data)
    expect(Requirements.data({ name: "OtherError", data: error.data })).toBeUndefined()
  })

  test("stores grouped guidance on AgentRequirementError message", () => {
    const error = Requirements.toError(
      result({
        state: "blocked",
        skills: [{ name: "missing-skill", status: "missing" }],
      }),
    )
    const text = Requirements.format(error)

    expect(text).toContain('Agent requirements are not met for "demo".')
    expect(text).toContain("Skills:")
    expect(text).toContain("missing-skill (missing)")
    expect(error.data.message).toBe(text)
  })

  test("formats AgentRequirementError in interactive session errors", () => {
    const error = Requirements.toError(
      result({
        state: "blocked",
        mcps: [{ name: "missing-mcp", status: "missing" }],
      }),
    )
    const text = Requirements.format(error)

    expect(formatStreamError(error)).toBe(text)
  })
})
