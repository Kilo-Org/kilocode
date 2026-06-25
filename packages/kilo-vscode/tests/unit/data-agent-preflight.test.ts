import { afterEach, describe, expect, it, mock } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  prepareDataAgent,
  prepareDataAgentOnce,
  type PreflightDeps,
  type PreflightReason,
} from "../../src/kilo-provider/data-agent-preflight"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { MarketplaceInstaller } from "../../src/services/marketplace/installer"
import { MarketplacePaths } from "../../src/services/marketplace/paths"
import type { AgentMarketplaceItem } from "../../src/services/marketplace/types"
import { TelemetryEventName } from "../../src/services/telemetry/types"

const dir = path.join(os.tmpdir(), `kilo-data-agent-test-${Date.now()}`)

class TestPaths extends MarketplacePaths {
  override configPath(): string {
    return path.join(dir, "kilo.json")
  }

  override agentsDir(): string {
    return path.join(dir, "agents")
  }
}

function agent(id = "data", name = "Data"): AgentMarketplaceItem {
  return {
    type: "agent",
    id,
    name,
    description: "Analyze data",
    category: "data",
    content: {
      mode: "primary",
      description: "Analyze and visualize data",
      prompt: "Use the available data tools.",
      permission: { bash: "ask" },
      options: { temperature: 0.2 },
    },
  }
}

function setup(input: Partial<PreflightDeps> = {}) {
  const logs: Array<{ message: string; detail?: unknown }> = []
  const reasons: PreflightReason[] = []
  const deps: PreflightDeps = {
    fetchAgents: mock(async () => [agent()]),
    installAgent: mock(async (item) => ({ success: true, slug: item.id })),
    invalidate: mock(async () => {}),
    log: mock((message, detail) => logs.push({ message, detail })),
    capture: mock((reason) => reasons.push(reason)),
    ...input,
  }
  return { deps, logs, reasons }
}

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("Data agent onboarding preflight", () => {
  it("installs only the exact Data marketplace agent", async () => {
    const installed: string[] = []
    const wrong = { ...agent(), type: "mcp" } as unknown as AgentMarketplaceItem
    const ctx = setup({
      fetchAgents: mock(async () => [agent("analyst", "Data"), agent("data-analysis"), wrong, agent()]),
      installAgent: mock(async (item) => {
        installed.push(item.id)
        return { success: true, slug: item.id }
      }),
    })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: true })
    expect(installed).toEqual(["data"])
    expect(ctx.deps.invalidate).toHaveBeenCalledTimes(1)
    expect(ctx.reasons).toEqual([])
  })

  it("installs Data globally through MarketplaceInstaller", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const ctx = setup({ installAgent: (item) => installer.installAgent(item, "global") })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: true })
    const content = await fs.readFile(path.join(dir, "agents", "data.md"), "utf-8")
    expect(content).toContain("mode: primary")
    expect(content).toContain("permission:")
    expect(content).toEndWith("\n\nUse the available data tools.\n")
  })

  it("preserves an existing global Data agent without invalidating it", async () => {
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const file = path.join(paths.agentsDir("global"), "data.md")
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "existing definition\n")
    const ctx = setup({ installAgent: (item) => installer.installAgent(item, "global") })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: true })
    expect(await fs.readFile(file, "utf-8")).toBe("existing definition\n")
    expect(ctx.deps.invalidate).not.toHaveBeenCalled()
    expect(ctx.reasons).toEqual([])
  })

  it("falls back when the exact catalog item is unavailable", async () => {
    const installAgent = mock(async (item: AgentMarketplaceItem) => ({ success: true, slug: item.id }))
    const ctx = setup({ fetchAgents: mock(async () => [agent("data-analysis", "Data")]), installAgent })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: false, reason: "unavailable" })
    expect(installAgent).not.toHaveBeenCalled()
    expect(ctx.reasons).toEqual(["unavailable"])
    expect(ctx.logs[0]?.message).toStartWith("[Kilo New]")
  })

  it("does not expose catalog errors in failure telemetry", async () => {
    const err = new Error("private catalog response")
    const ctx = setup({ fetchAgents: mock(async () => Promise.reject(err)) })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: false, reason: "unavailable" })
    expect(ctx.logs[0]?.detail).toBe(err)
    expect(ctx.reasons).toEqual(["unavailable"])
    expect(JSON.stringify(ctx.reasons)).not.toContain(err.message)
  })

  it("classifies a reported install failure separately", async () => {
    const ctx = setup({
      installAgent: mock(async () => ({ success: false, slug: "data", error: "permission denied" })),
    })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: false, reason: "install" })
    expect(ctx.reasons).toEqual(["install"])
    expect(ctx.logs[0]?.detail).toBe("permission denied")
  })

  it("classifies installer exceptions without exposing them in telemetry", async () => {
    const err = new Error("private filesystem path")
    const ctx = setup({ installAgent: mock(async () => Promise.reject(err)) })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: false, reason: "unexpected" })
    expect(ctx.logs[0]?.detail).toBe(err)
    expect(ctx.reasons).toEqual(["unexpected"])
  })

  it("succeeds when invalidation fails", async () => {
    const err = new Error("backend unavailable")
    const ctx = setup({ invalidate: mock(async () => Promise.reject(err)) })

    expect(await prepareDataAgent(ctx.deps)).toEqual({ available: true })
    expect(ctx.logs).toEqual([
      { message: "[Kilo New] Failed to invalidate the CLI after installing the Data agent:", detail: err },
    ])
    expect(ctx.reasons).toEqual([])
  })

  it("deduplicates concurrent failures and telemetry per extension host", async () => {
    const connection = {} as KiloConnectionService
    const ctx = setup({ fetchAgents: mock(async () => []) })

    const results = await Promise.all([
      prepareDataAgentOnce(connection, "/repo", ctx.deps),
      prepareDataAgentOnce(connection, "/repo", ctx.deps),
    ])

    expect(results).toEqual([
      { available: false, reason: "unavailable" },
      { available: false, reason: "unavailable" },
    ])
    expect(ctx.deps.fetchAgents).toHaveBeenCalledTimes(1)
    expect(ctx.reasons).toEqual(["unavailable"])
  })

  it("declares a dedicated preparation failure event", () => {
    expect(TelemetryEventName.DATA_AGENT_ONBOARDING_PREPARATION_FAILED).toBe("Data Agent Onboarding Preparation Failed")
  })
})
