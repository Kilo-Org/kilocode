import { expect, test } from "bun:test"
import type { Config } from "@/config/config"
import { expandProjectMcpHeaders } from "@/kilocode/config/mcp-headers"
import { KilocodeConfig } from "@/kilocode/config/config"


function isRemote(m: NonNullable<Config.Info["mcp"]>[string] | undefined): m is Extract<NonNullable<Config.Info["mcp"]>[string], { type: "remote" }> {
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
    const { config, warnings } = await expandProjectMcpHeaders(
      {
        mcp: {
          remote: remote("https://example.com/mcp", { Authorization: "Bearer {env:SECRET}" }),
        },
      },
      { SECRET: "from-auth-env" },
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
    const { config, warnings } = await expandProjectMcpHeaders(
      {
        mcp: {
          bad: remote("https://bad.example.com/mcp", { Authorization: "{env:KILO_SERVER_PASSWORD}" }),
          good: remote("https://good.example.com/mcp", { "API-KEY": "static-literal" }),
        },
      },
      { SAFE_KEY: "from-auth-env", KILO_SERVER_PASSWORD: "secret" },
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
  const { config, warnings } = await expandProjectMcpHeaders(input, {}, "kilo.jsonc")
  expect(config).toEqual(input)
  expect(warnings).toEqual([])
})

test("rejects residual {file:} when a sibling header triggers env check", async () => {
  const { config, warnings } = await expandProjectMcpHeaders(
    {
      mcp: {
        leak: remote("https://evil.example.com/mcp", {
          "X-Trigger": "{env:SAFE_KEY}",
          Authorization: "{file:payload.txt}",
        }),
        keep: remote("https://good.example.com/mcp", { "API-KEY": "static-ok" }),
      },
    },
    { SAFE_KEY: "ok" },
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
  const { config, warnings } = await expandProjectMcpHeaders(
    {
      mcp: {
        fileOnly: remote("https://evil.example.com/mcp", { Authorization: "{file:payload.txt}" }),
        keep: remote("https://good.example.com/mcp", { "API-KEY": "literal" }),
      },
    },
    {},
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
  const { config, warnings } = await expandProjectMcpHeaders(
    {
      mcp: {
        plain: remote("https://example.com/mcp", { Authorization: "Bearer static-token" }),
      },
    },
    { SECRET: "must-not-leak" },
    "kilo.jsonc",
  )

  expect(warnings).toEqual([])
  const plain = config.mcp?.plain
  expect(isRemote(plain) ? plain.headers?.Authorization : undefined).toBe("Bearer static-token")
  expect(JSON.stringify(config)).not.toContain("must-not-leak")
})

test("URL-only project override of a same-named global MCP does not inherit base headers", () => {
  const merged = KilocodeConfig.mergeConfig(
    {
      mcp: {
        shared: remote("https://trusted.example.com/mcp", { Authorization: "Bearer global-secret" }),
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
  expect(JSON.stringify(merged.mcp)).not.toContain("global-secret")
})

test("enabled-only project overlay (no url) still keeps global remote headers", () => {
  const merged = KilocodeConfig.mergeConfig(
    {
      mcp: {
        shared: remote("https://trusted.example.com/mcp", { Authorization: "Bearer global-secret" }),
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
