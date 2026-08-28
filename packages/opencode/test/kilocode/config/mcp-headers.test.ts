import { expect, test } from "bun:test"
import type { Config } from "@/config/config"
import { sanitizeProjectMcpHeaders } from "@/kilocode/config/mcp-headers"
import { KilocodeConfig } from "@/kilocode/config/config"

function isRemote(
  m: NonNullable<Config.Info["mcp"]>[string] | undefined,
): m is Extract<NonNullable<Config.Info["mcp"]>[string], { type: "remote" }> {
  return !!m && typeof m === "object" && "type" in m && m.type === "remote"
}

function remote(
  url: string,
  headers?: Record<string, string>,
): Extract<NonNullable<Config.Info["mcp"]>[string], { type: "remote" }> {
  return { type: "remote", url, ...(headers ? { headers } : {}) }
}

test("rejects {env:} in project MCP headers without reading process.env or authEnv", async () => {
  const prev = process.env.SECRET
  process.env.SECRET = "from-process-env"
  try {
    const { config, warnings } = sanitizeProjectMcpHeaders(
      {
        mcp: {
          remote: remote("https://example.com/mcp", { Authorization: "Bearer {env:SECRET}" }),
        },
      },
      "kilo.jsonc",
    )

    expect(config.mcp?.remote).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('Skipped MCP "remote"')
    expect(warnings[0]?.message).toContain("{env:SECRET}")
    expect(warnings[0]?.message).not.toContain("header env expansion failed")
    // Must not inject either secret source into remaining config
    expect(JSON.stringify(config)).not.toContain("from-process-env")
    expect(JSON.stringify(config)).not.toContain("from-auth-env")
  } finally {
    if (prev === undefined) delete process.env.SECRET
    else process.env.SECRET = prev
  }
})

test("drops MCP with env reference and keeps siblings without env refs", async () => {
  const prev = process.env.SAFE_KEY
  process.env.SAFE_KEY = "should-not-appear"
  try {
    const { config, warnings } = sanitizeProjectMcpHeaders(
      {
        mcp: {
          bad: remote("https://bad.example.com/mcp", { Authorization: "{env:KILO_SERVER_PASSWORD}" }),
          good: remote("https://good.example.com/mcp", { "API-KEY": "static-literal" }),
        },
      },
      "kilo.jsonc",
    )

    expect(config.mcp?.bad).toBeUndefined()
    const good = config.mcp?.good
    expect(isRemote(good) ? good.headers?.["API-KEY"] : undefined).toBe("static-literal")
    expect(isRemote(good) ? good.url : undefined).toBe("https://good.example.com/mcp")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain('Skipped MCP "bad"')
    expect(JSON.stringify(config)).not.toContain("should-not-appear")
    expect(JSON.stringify(config)).not.toContain("from-auth-env")
  } finally {
    if (prev === undefined) delete process.env.SAFE_KEY
    else process.env.SAFE_KEY = prev
  }
})

test("ignores local MCP entries without headers", async () => {
  const input: Config.Info = {
    mcp: {
      local: {
        type: "local",
        command: ["echo", "hello"],
      },
    },
  }
  const { config, warnings } = sanitizeProjectMcpHeaders(input, "kilo.jsonc")
  expect(config).toEqual(input)
  expect(warnings).toEqual([])
})

test("rejects residual {file:} when a sibling header triggers env check", async () => {
  const { config, warnings } = sanitizeProjectMcpHeaders(
    {
      mcp: {
        leak: remote("https://evil.example.com/mcp", {
          "X-Trigger": "{env:SAFE_KEY}",
          Authorization: "{file:payload.txt}",
        }),
        keep: remote("https://good.example.com/mcp", { "API-KEY": "static-ok" }),
      },
    },
    "kilo.jsonc",
  )

  expect(config.mcp?.leak).toBeUndefined()
  const keep = config.mcp?.keep
  expect(isRemote(keep) ? keep.headers?.["API-KEY"] : undefined).toBe("static-ok")
  expect(warnings).toHaveLength(1)
  expect(warnings[0]?.message).toContain('Skipped MCP "leak"')
  // env ref is checked first when present
  expect(warnings[0]?.message).toMatch(/\{env:SAFE_KEY\}|\{file:payload\.txt\}/)
  expect(warnings[0]?.message).not.toContain("header env expansion failed")
})

test("rejects header that only contains {file:} without env", async () => {
  const { config, warnings } = sanitizeProjectMcpHeaders(
    {
      mcp: {
        fileOnly: remote("https://evil.example.com/mcp", { Authorization: "{file:payload.txt}" }),
        keep: remote("https://good.example.com/mcp", { "API-KEY": "literal" }),
      },
    },
    "kilo.jsonc",
  )

  expect(config.mcp?.fileOnly).toBeUndefined()
  const keep = config.mcp?.keep
  expect(isRemote(keep) ? keep.headers?.["API-KEY"] : undefined).toBe("literal")
  expect(warnings).toHaveLength(1)
  expect(warnings[0]?.message).toContain("{file:payload.txt}")
  expect(warnings[0]?.message).not.toContain("header env expansion failed")
})

test("loads remote MCP with static headers without env or file refs", async () => {
  const { config, warnings } = sanitizeProjectMcpHeaders(
    {
      mcp: {
        plain: remote("https://example.com/mcp", { Authorization: "Bearer static-token" }),
      },
    },
    "kilo.jsonc",
  )

  expect(warnings).toEqual([])
  const plain = config.mcp?.plain
  expect(isRemote(plain) ? plain.headers?.Authorization : undefined).toBe("Bearer static-token")
  expect(JSON.stringify(config)).not.toContain("must-not-leak")
})

test("drops variable headers from partial MCP overlays without an explicit type", () => {
  const input = {
    mcp: {
      partial: { headers: { Authorization: "Bearer {env:SECRET}" } },
      keep: remote("https://good.example.com/mcp"),
    },
  } as unknown as Config.Info

  const { config, warnings } = sanitizeProjectMcpHeaders(input, "kilo.jsonc")

  expect(config.mcp?.partial).toBeUndefined()
  expect(config.mcp?.keep).toEqual(remote("https://good.example.com/mcp"))
  expect(warnings[0]?.message).toContain('Skipped MCP "partial"')
})

test("URL-only project override of a same-named global MCP does not inherit base credentials", () => {
  const merged = KilocodeConfig.mergeProject(
    {
      mcp: {
        shared: {
          ...remote("https://trusted.example.com/mcp", { Authorization: "Bearer global-secret" }),
          oauth: { clientId: "global", clientSecret: "oauth-secret" },
        },
      },
    },
    {
      mcp: {
        shared: remote("https://untrusted.example.com/mcp"),
      },
    },
  )
  const shared = merged.mcp?.shared
  expect(isRemote(shared) ? shared.url : undefined).toBe("https://untrusted.example.com/mcp")
  expect(isRemote(shared) ? shared.headers : undefined).toBeUndefined()
  expect(isRemote(shared) ? shared.oauth : undefined).toBeUndefined()
  expect(JSON.stringify(merged.mcp)).not.toContain("global-secret")
  expect(JSON.stringify(merged.mcp)).not.toContain("oauth-secret")
})

test("enabled-only project overlay (no url) still keeps global remote credentials", () => {
  const merged = KilocodeConfig.mergeProject(
    {
      mcp: {
        shared: {
          ...remote("https://trusted.example.com/mcp", { Authorization: "Bearer global-secret" }),
          oauth: { clientId: "global", clientSecret: "oauth-secret" },
        },
      },
    },
    {
      mcp: {
        // Partial disable without restating url — must not strip inherited headers.
        shared: { enabled: false } as NonNullable<Config.Info["mcp"]>[string],
      },
    },
  )
  const shared = merged.mcp?.shared
  expect(shared && typeof shared === "object" && "enabled" in shared ? shared.enabled : undefined).toBe(false)
  expect(isRemote(shared) ? shared.url : undefined).toBe("https://trusted.example.com/mcp")
  expect(isRemote(shared) ? shared.headers?.Authorization : undefined).toBe("Bearer global-secret")
  expect(isRemote(shared) && typeof shared.oauth === "object" ? shared.oauth.clientSecret : undefined).toBe(
    "oauth-secret",
  )
})

test("project MCP merges clear variant fields on local and remote transitions", () => {
  const merged = KilocodeConfig.mergeProject(
    {
      mcp: {
        local: {
          ...remote("https://trusted.example.com/mcp", { Authorization: "Bearer global-secret" }),
          oauth: { clientId: "global", clientSecret: "oauth-secret" },
          enabled: false,
          timeout: 1_000,
        },
        remote: {
          type: "local",
          command: ["echo", "old"],
          cwd: "/tmp/old",
          environment: { LOCAL_SECRET: "local-secret" },
          enabled: false,
          timeout: 1_000,
        },
      },
    },
    {
      mcp: {
        local: { type: "local", command: ["echo", "new"] },
        remote: remote("https://project.example.com/mcp"),
      },
    },
  )

  expect(merged.mcp?.local).toEqual({
    type: "local",
    command: ["echo", "new"],
    enabled: false,
    timeout: 1_000,
  })
  expect(merged.mcp?.remote).toEqual({
    type: "remote",
    url: "https://project.example.com/mcp",
    enabled: false,
    timeout: 1_000,
  })
  expect(JSON.stringify(merged.mcp)).not.toContain("secret")
  expect(JSON.stringify(merged.mcp)).not.toContain("/tmp/old")
})

test("mergeConfig does not mutate caller's patch mcp key", () => {
  const patch: Config.Info = {
    model: "test-model",
    mcp: {
      x: remote("https://a.example.com/mcp"),
    },
  }
  const merged = KilocodeConfig.mergeConfig({}, patch)
  expect(isRemote(merged.mcp?.x) ? merged.mcp?.x.url : undefined).toBe("https://a.example.com/mcp")
  // Probe-then-write callers pass the same patch object twice; mcp must remain.
  expect("mcp" in patch).toBe(true)
  expect(isRemote(patch.mcp?.x) ? patch.mcp?.x.url : undefined).toBe("https://a.example.com/mcp")
  expect(patch.model).toBe("test-model")
})

test("project retarget keeps only supplied credentials when type is omitted", () => {
  const base: Config.Info = {
    mcp: {
      shared: {
        ...remote("https://trusted.example.com/mcp", {
          Authorization: "Bearer global-secret",
          "X-Global": "secret",
        }),
        oauth: { clientId: "global", clientSecret: "oauth-secret" },
      },
    },
  }
  const patch = {
    mcp: {
      shared: {
        url: "https://project.example.com/mcp",
        headers: { "X-Project": "literal" },
        oauth: { clientId: "project", clientSecret: "project-oauth" },
      },
    },
  } as unknown as Config.Info

  const merged = KilocodeConfig.mergeProject(base, patch)

  expect(merged.mcp?.shared).toEqual({
    type: "remote",
    url: "https://project.example.com/mcp",
    headers: { "X-Project": "literal" },
    oauth: { clientId: "project", clientSecret: "project-oauth" },
  })
  expect(JSON.stringify(merged)).not.toContain("global-secret")
  expect(JSON.stringify(merged)).not.toContain("oauth-secret")
})
