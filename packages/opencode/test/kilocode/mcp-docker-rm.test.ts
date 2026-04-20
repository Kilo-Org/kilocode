import { test, expect, describe } from "bun:test"
import { MCP } from "../../src/mcp"

describe("ensureDockerRm", () => {
  test("injects --rm after 'run' for docker run commands", () => {
    const result = MCP.ensureDockerRm("docker", ["run", "-i", "my-image"])
    expect(result).toEqual(["run", "--rm", "-i", "my-image"])
  })

  test("skips adding --rm when already present (idempotent)", () => {
    const args = ["run", "--rm", "-i", "my-image"]
    const result = MCP.ensureDockerRm("docker", args)
    expect(result).toBe(args)
  })

  test("does not modify non-docker commands", () => {
    const args = ["-y", "@modelcontextprotocol/server-filesystem"]
    const result = MCP.ensureDockerRm("npx", args)
    expect(result).toBe(args)
  })

  test("does not modify docker commands that are not 'run'", () => {
    const args = ["build", "-t", "my-image", "."]
    const result = MCP.ensureDockerRm("docker", args)
    expect(result).toBe(args)
  })

  test("handles docker run with no additional args", () => {
    const result = MCP.ensureDockerRm("docker", ["run"])
    expect(result).toEqual(["run", "--rm"])
  })
})
