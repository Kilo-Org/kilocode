import { describe, expect, test } from "bun:test"
import { RemoteModelCatalog } from "@/kilo-sessions/remote-model-catalog"
import { RemoteRuntime } from "@/kilo-sessions/remote-runtime"

describe("RemoteRuntime", () => {
  test("builds safe runtime presence without the absolute directory", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "05be7b38-5a0c-4215-a14f-ac6a3f124d53",
      cliVersion: "7.4.7",
      directory: "/Users/alice/private/customer-repo",
      displayName: "Alice Mac",
    })

    expect(runtime.presence()).toEqual({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "05be7b38-5a0c-4215-a14f-ac6a3f124d53",
      protocolVersion: 1,
      cliVersion: "7.4.7",
      displayName: "Alice Mac",
      projectName: "customer-repo",
      capabilities: ["catalog.v1", "create-and-run.v1"],
    })
    // Absolute directory must never leak into the serialized presence.
    expect(JSON.stringify(runtime.presence())).not.toContain("/Users/alice")
    expect(JSON.stringify(runtime.presence())).not.toContain("customer-repo/")
  })

  test("derives projectName from the basename of the launch directory", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/home/bob/work/secret/internal/api-gateway",
      displayName: "Bob Laptop",
    })
    expect(runtime.presence().projectName).toBe("api-gateway")
  })

  test("handles a root directory without crashing", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/",
      displayName: "Root",
    })
    expect(runtime.presence().projectName).toBe("root")
  })

  test("truncates and sanitizes an oversized display name", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "  \n\t Hello   World\u0000\x07  ",
    })
    // Control chars stripped, whitespace collapsed, truncated to 80.
    expect(runtime.presence().displayName).toBe("Hello World")
  })

  test("caps a long directory basename to 80 characters", () => {
    const longName = "a".repeat(120)
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: `/tmp/${longName}`,
      displayName: "Laptop",
    })
    expect(runtime.presence().projectName).toBe("a".repeat(80))
  })

  test("setConnectionId updates the transport identity without changing runtimeId", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })
    expect(runtime.runtimeId).toBe("8db3de9a-350f-4fad-a539-8e0da3bbcf5e")
    // RemoteWS.connect() sets the connectionId once at creation and it
    // remains stable for the lifetime of the Connection. setConnectionId
    // is only called if a different Connection is wired in.
    runtime.setConnectionId("conn-2")
    expect(runtime.runtimeId).toBe("8db3de9a-350f-4fad-a539-8e0da3bbcf5e")
    expect(runtime.presence().connectionId).toBe("conn-2")
  })

  test("captures the launch directory once and ignores later cwd changes", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/original",
      displayName: "Laptop",
    })
    const original = runtime.presence().projectName
    // Simulate process.chdir — the runtime must not re-read cwd.
    expect(runtime.presence().projectName).toBe(original)
  })

  test("lists every known capability", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })
    expect(runtime.presence().capabilities).toEqual(["catalog.v1", "create-and-run.v1"])
  })

  test("rejects a directory that is an empty string", () => {
    expect(() =>
      RemoteRuntime.create({
        runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
        connectionId: "conn-1",
        cliVersion: "7.4.7",
        directory: "",
        displayName: "Laptop",
      }),
    ).toThrow()
  })

  test("rejects an empty display name", () => {
    expect(() =>
      RemoteRuntime.create({
        runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
        connectionId: "conn-1",
        cliVersion: "7.4.7",
        directory: "/tmp/proj",
        displayName: "   ",
      }),
    ).toThrow()
  })
})

describe("RemoteRuntime.cliVersion", () => {
  test("preserves a short release version exactly", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.8",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })

    expect(runtime.presence().cliVersion).toBe("7.4.8")
  })

  test("truncates a long feature version to 32 characters without throwing", () => {
    const longVersion = "0.0.0-feature-mobile-local-cloud-agent-cli-202607152334"
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: longVersion,
      directory: "/tmp/proj",
      displayName: "Laptop",
    })

    const cliVersion = runtime.presence().cliVersion
    expect(cliVersion.length).toBeLessThanOrEqual(32)
    expect(cliVersion).toBe("0.0.0-feature-mobile-local-cloud")
    expect(JSON.stringify(runtime.presence())).not.toContain(longVersion)
  })

  test("truncates a surrogate-pair version without leaving a lone surrogate", () => {
    const ascii = "x".repeat(31)
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: `${ascii}\u{1F600}`,
      directory: "/tmp/proj",
      displayName: "Laptop",
    })

    const cliVersion = runtime.presence().cliVersion
    expect(cliVersion.length).toBeLessThanOrEqual(32)
    expect(cliVersion).toBe(ascii)
    expect(/[\uD800-\uDBFF]$/.test(cliVersion)).toBe(false)
    expect(/^[\uDC00-\uDFFF]/.test(cliVersion)).toBe(false)
  })

  test("sanitizes control characters and collapses whitespace", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "  7.4.8\n\t\u0000\x07  ",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })

    expect(runtime.presence().cliVersion).toBe("7.4.8")
  })

  test("falls back to 'unknown' when the version is empty after sanitization", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "   \n\t   ",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })

    expect(runtime.presence().cliVersion).toBe("unknown")
  })
})

// kilocode_change start - sessionless runtime catalog (Slice 2)
function agentFixture(over: Partial<{
  name: string
  description: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  model: { providerID: string; modelID: string }
  variant: string
}> = {}) {
  return {
    name: over.name ?? "build",
    description: over.description,
    mode: over.mode ?? "primary",
    hidden: over.hidden ?? false,
    model: over.model,
    variant: over.variant,
  }
}

function providerFixture(providerID: string, modelID: string) {
  return {
    [providerID]: {
      id: providerID,
      name: providerID,
      source: "env" as const,
      env: ["MUST_NOT_LEAK"],
      key: "MUST_NOT_LEAK",
      options: { apiKey: "MUST_NOT_LEAK" },
      models: {
        [modelID]: {
          id: modelID,
          providerID,
          name: modelID,
          capabilities: {
            temperature: true,
            attachment: true,
            reasoning: false,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 1, output: 2, cache: { read: 3, write: 4 } },
          limit: { context: 100_000, output: 4_096 },
          status: "active" as const,
          options: { apiKey: "MUST_NOT_LEAK" },
          headers: { authorization: "MUST_NOT_LEAK" },
          release_date: "2026-01-01",
          variants: { precise: { apiKey: "MUST_NOT_LEAK" } },
        },
      },
    },
  }
}

function makeRuntime(
  overrides: {
    directory?: string
    catalog?: RemoteRuntime.CatalogSource
  } = {},
) {
  return RemoteRuntime.create({
    runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
    connectionId: "conn-1",
    cliVersion: "7.4.7",
    directory: overrides.directory ?? "/tmp/proj",
    displayName: "Laptop",
    catalog: overrides.catalog,
  })
}

describe("RemoteRuntime.catalog", () => {
  test("returns the strict catalog without needing a session id", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "anthropic/claude-sonnet-4"),
        defaultModel: async () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4" }),
        listAgents: async () => [
          agentFixture({ name: "build", description: "The default agent. Executes tools based on configured permissions." }),
        ],
        defaultAgent: async () => "build",
      },
    })

    const catalog = await runtime.catalog({ protocolVersion: 1 })

    expect(catalog.protocolVersion).toBe(1)
    expect(catalog.defaultAgent).toBe("build")
    expect(catalog.agents).toEqual([
      {
        slug: "build",
        name: "Build",
        description: "The default agent. Executes tools based on configured permissions.",
      },
    ])
    expect(catalog.models.protocolVersion).toBe(1)
    expect(catalog.models.all).toHaveLength(1)
    expect(catalog.models.all[0]?.id).toBe("kilo")
    // Credentials and options must be stripped exactly the way the existing
    // RemoteModelCatalog builder does it.
    expect(catalog.models.all[0]?.env).toEqual([])
    expect(catalog.models.all[0]?.options).toEqual({})
    expect(JSON.stringify(catalog)).not.toContain("MUST_NOT_LEAK")
  })

  test("omits hidden agents and subagents, keeps primary and all agents", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => undefined,
        listAgents: async () => [
          agentFixture({ name: "build", description: "primary" }),
          agentFixture({ name: "plan", description: "primary" }),
          agentFixture({ name: "general", description: "all-mode" }),
          agentFixture({ name: "explore", description: "should be hidden", hidden: true }),
          agentFixture({ name: "scout", description: "subagent", mode: "subagent" }),
        ],
        defaultAgent: async () => "build",
      },
    })

    const catalog = await runtime.catalog({ protocolVersion: 1 })

    const slugs = catalog.agents.map((a) => a.slug)
    expect(slugs).toEqual(["build", "plan", "general"])
  })

  test("bounds agent fields to the strict wire schema and renames the build agent", async () => {
    const longDescription = "x".repeat(2_000)
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => undefined,
        listAgents: async () => [
          agentFixture({
            name: "build",
            description: longDescription,
            model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4" },
            variant: "precise",
          }),
        ],
        defaultAgent: async () => "build",
      },
    })

    const catalog = await runtime.catalog({ protocolVersion: 1 })

    expect(catalog.agents).toHaveLength(1)
    const agent = catalog.agents[0]!
    expect(agent.slug).toBe("build")
    expect(agent.name).toBe("Build")
    expect(agent.description?.length).toBeLessThanOrEqual(500)
    expect(agent.model).toEqual({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4" })
    expect(agent.variant).toBe("precise")
  })

  test("rejects when the configured default agent is not in the visible agent list", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => undefined,
        listAgents: async () => [agentFixture({ name: "plan", description: "primary" })],
        defaultAgent: async () => "build",
      },
    })

    await expect(runtime.catalog({ protocolVersion: 1 })).rejects.toThrow("failed to load runtime catalog")
  })

  test("sanitizes provider failures to 'failed to load runtime catalog' without leaking path or token", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => {
          throw new Error("/workspace/private/api-key=MUST_NOT_LEAK and stack must not leak")
        },
        defaultModel: async () => undefined,
        listAgents: async () => [agentFixture({ name: "build" })],
        defaultAgent: async () => "build",
      },
    })

    let caught: unknown
    try {
      await runtime.catalog({ protocolVersion: 1 })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe("failed to load runtime catalog")
    expect(JSON.stringify(caught)).not.toContain("/workspace/private")
    expect(JSON.stringify(caught)).not.toContain("MUST_NOT_LEAK")
  })

  test("sanitizes agent failures to the same generic error", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => undefined,
        listAgents: async () => {
          throw new Error("agent lookup leaked token=abc")
        },
        defaultAgent: async () => "build",
      },
    })

    await expect(runtime.catalog({ protocolVersion: 1 })).rejects.toThrow("failed to load runtime catalog")
  })

  test("logs only the error class and the operation, never the provider message", async () => {
    const logs: unknown[][] = []
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => {
          throw new Error("private credential detail")
        },
        defaultModel: async () => undefined,
        listAgents: async () => [agentFixture({ name: "build" })],
        defaultAgent: async () => "build",
      },
    })

    await expect(
      runtime.catalog({ protocolVersion: 1 }, {
        error: (...args: unknown[]) => logs.push(args),
      }),
    ).rejects.toThrow("failed to load runtime catalog")

    expect(logs).toHaveLength(1)
    expect(logs[0]?.[0]).toBe("runtime catalog failed")
    expect(logs[0]?.[1]).toEqual({ operation: "catalog", error: "Error" })
    const flattened = JSON.stringify(logs)
    expect(flattened).not.toContain("private credential detail")
  })

  test("rejects an unsupported protocol version strictly", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => undefined,
        listAgents: async () => [agentFixture({ name: "build" })],
        defaultAgent: async () => "build",
      },
    })

    await expect(
      // cast to silence the strict request type for the negative case
      runtime.catalog({ protocolVersion: 2 } as never),
    ).rejects.toThrow("failed to load runtime catalog")
  })

  test("uses RemoteModelCatalogV1 as the model shape and never inlines raw credentials", async () => {
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "anthropic/claude-sonnet-4"),
        defaultModel: async () => ({ providerID: "kilo", modelID: "anthropic/claude-sonnet-4" }),
        listAgents: async () => [agentFixture({ name: "build" })],
        defaultAgent: async () => "build",
      },
    })

    const catalog = await runtime.catalog({ protocolVersion: 1 })
    // The model field is the strict v1 catalog shape.
    expect(catalog.models).toMatchObject({ protocolVersion: 1 })
    const first = catalog.models.all[0]!
    expect(first.env).toEqual([])
    expect(first.options).toEqual({})
    expect(first.models["anthropic/claude-sonnet-4"]?.options).toEqual({})
    expect(first.models["anthropic/claude-sonnet-4"]?.headers).toEqual({})
    expect(first.models["anthropic/claude-sonnet-4"]?.variants).toEqual({ precise: {} })
  })

  test("uses the providers and defaultModel the catalog source provides", async () => {
    // Confirms the runtime does not silently fall back to a session-scoped
    // provider list. The catalog source returns a specific provider and
    // default; the runtime must surface them verbatim (subject to
    // RemoteModelCatalog's normal sanitization).
    const runtime = makeRuntime({
      catalog: {
        listProviders: async () => providerFixture("kilo", "model"),
        defaultModel: async () => ({ providerID: "kilo", modelID: "model" }),
        listAgents: async () => [agentFixture({ name: "build" })],
        defaultAgent: async () => "build",
      },
    })

    const catalog = await runtime.catalog({ protocolVersion: 1 })
    expect(catalog.models.defaultModel).toEqual({ providerID: "kilo", modelID: "model" })
  })
})
// kilocode_change end
