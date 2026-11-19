import { describe, expect, test } from "bun:test"
import { match } from "../../core/src/util/wildcard"
import {
  admitted,
  createPolicyClient,
  decide,
  MemberPolicySchema,
  type MemberPolicy,
  type PolicyEntry,
  unrestricted,
} from "@kilocode/kilo-gateway/permission-policy"
// Producer fixtures from Kilo-Org/cloud at 946127976b0146dd8e77b430884253d728541f80,
// packages/web-shared/src/lib/organizations/group-policies/permission-policy/v1-fixtures.json.
import fixtures from "./fixtures/permission-policy-v1.json"

const layered = MemberPolicySchema.parse(fixtures.layered)
const enabled = fixtures.enabled_empty
const tag = fixtures.conditional.etag
const org = enabled.organization_id
const other = "5d10f1cc-d595-41ee-8eb6-4a450d7c5ad3"

function policy(type: "agent_permissions" | "client_access", ...layers: unknown[]): MemberPolicy {
  return MemberPolicySchema.parse({ ...enabled, policy: { [type]: { layers } } })
}

function serve(fetch: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })
  return {
    scope: { origin: server.url.origin, organization: org, account: "fixture-account", token: "fixture-token" },
    [Symbol.dispose]: () => void server.stop(true),
  }
}

function ok(policy: unknown = layered, etag = tag, status = 200) {
  return Response.json(policy, { status, headers: { etag } })
}

function notModified(etag?: string) {
  const fixture = fixtures.conditional.same_authorized_representation
  return new Response(fixture.body, { status: fixture.status, headers: etag === undefined ? {} : { etag } })
}

describe("member policy schema and evaluator", () => {
  test("round-trips the pinned Cloud documents with absent fields preserved", () => {
    for (const fixture of [fixtures.layered, enabled, fixtures.disabled]) {
      expect(MemberPolicySchema.parse(fixture)).toStrictEqual(fixture)
    }
    for (const fixture of [enabled, fixtures.disabled]) {
      const parsed = MemberPolicySchema.parse(fixture)
      expect(decide(parsed, { tool: "bash" }, match)).toBeUndefined()
      expect(admitted(parsed, undefined, undefined)).toBe(true)
      expect(unrestricted(parsed)).toBe(true)
    }
  })

  test("matches the producer's layered decisions without changing local matcher input", () => {
    for (const row of fixtures.layered_expectations.shell) {
      if (row.kind !== "bash" && row.kind !== "powershell") throw new Error("Unknown shell in Cloud fixture")
      const shell = { kind: row.kind, commands: [row.command], uncertain: false } as const
      expect(decide(layered, { tool: "bash", shell }, match)).toBe(row.decision)
    }
    for (const row of fixtures.layered_expectations.tools) {
      const decision = decide(layered, { tool: row.tool, resources: row.resource ? [row.resource] : undefined }, match)
      expect(decision).toBe(row.decision === "inherit" ? undefined : row.decision)
    }
    for (const row of fixtures.layered_expectations.admission) {
      expect(admitted(layered, row.feature ?? undefined, row.version)).toBe(row.admitted)
    }
    expect(unrestricted(layered)).toBe(false)
    expect(decide(layered, { tool: "webfetch", resources: ["https://DOCS.example.test/start"] }, match)).toBe("allow")
    expect(decide(layered, { tool: "webfetch", resources: ["https://other.example.test/start"] }, match)).toBe("ask")
  })

  test("matches exact tool keys and applies unmatched fallbacks independently for each resource and layer", () => {
    const parsed = policy(
      "agent_permissions",
      {
        schema_version: 1,
        unrestricted_mode: "allow",
        tools: {
          "*": "deny",
          mcp_read: { rules: [{ pattern: "/shared/*", action: "allow" }], fallback: "ask" },
          external_directory: { rules: [{ pattern: "/shared/*", action: "deny" }] },
        },
      },
      { schema_version: 1, unrestricted_mode: "deny", tools: { mcp_read: "allow", bash: "ask" } },
    )
    expect(decide(parsed, { tool: "mcp_read", resources: ["/shared/a"] }, match)).toBe("allow")
    expect(decide(parsed, { tool: "mcp_read", resources: ["/shared/a", "/other/b"] }, match)).toBe("ask")
    expect(decide(parsed, { tool: "mcp_read" }, match)).toBe("ask")
    expect(decide(parsed, { tool: "external_directory", resources: ["/shared/a"] }, match)).toBe("deny")
    expect(decide(parsed, { tool: "mcp_write", resources: ["/shared/a"] }, match)).toBeUndefined()
    expect(decide(parsed, { tool: "bash" }, match)).toBe("ask")
    expect(unrestricted(parsed)).toBe(false)
  })

  test("combines shell-tool actions, per-command decisions, missing profiles and uncertainty restrictively", () => {
    const bash = {
      fallback: "ask",
      rules: [
        { pattern: "git status *", action: "allow" },
        { pattern: "git push *", action: "deny" },
      ],
    }
    const powershell = {
      fallback: "ask",
      rules: [
        { pattern: "Get-Location *", action: "allow" },
        { pattern: "Set-Location *", action: "deny" },
      ],
    }
    const layer = { schema_version: 1, shell: { bash, powershell } }
    const parsed = policy("agent_permissions", layer, { schema_version: 1, tools: { external_directory: "deny" } })
    const shell = { kind: "bash", commands: ["git status"], uncertain: false } as const
    expect(decide(parsed, { tool: "bash", shell }, match)).toBe("allow")
    expect(decide(parsed, { tool: "bash", shell: { ...shell, uncertain: true } }, match)).toBe("ask")
    expect(decide(parsed, { tool: "bash", shell: { ...shell, commands: [] } }, match)).toBe("ask")
    expect(decide(parsed, { tool: "bash", shell: { ...shell, commands: ["git status", "git show"] } }, match)).toBe(
      "ask",
    )
    expect(
      decide(
        parsed,
        { tool: "bash", shell: { ...shell, commands: ["git status", "git push"], uncertain: true } },
        match,
      ),
    ).toBe("deny")
    expect(decide(parsed, { tool: "bash", shell: { ...shell, kind: "unsupported" } }, match)).toBe("deny")
    expect(decide(parsed, { tool: "bash" }, match)).toBe("deny")
    expect(decide(parsed, { tool: "external_directory", resources: ["/shared/a"], shell }, match)).toBe("deny")
    const ps = { kind: "powershell", commands: ["get-location"], uncertain: false } as const
    expect(decide(parsed, { tool: "bash", shell: ps }, match)).toBe("allow")
    expect(decide(parsed, { tool: "bash", shell: { ...ps, commands: ["SET-LOCATION"] } }, match)).toBe("deny")
    expect(
      decide(policy("agent_permissions", layer, { schema_version: 1, shell: {} }), { tool: "bash", shell }, match),
    ).toBe("deny")
    expect(
      decide(
        policy("agent_permissions", layer, { schema_version: 1, tools: { bash: "deny" } }),
        { tool: "bash", shell },
        match,
      ),
    ).toBe("deny")
  })

  test("checks minimum SemVer precedence, ignores build metadata and evaluates every admission layer", () => {
    const access = (min_version: string) =>
      policy("client_access", { schema_version: 1, mode: "allowlist", clients: [{ feature: "cli", min_version }] })
    for (const [actual, expected] of [
      [undefined, false],
      ["v1.2.3", false],
      ["1.2.3-beta.01", false],
      ["1.2.2", false],
      ["1.2.3-beta.2", false],
      ["1.2.3-beta.10+any.001", true],
      ["1.2.3-beta.10.extra", true],
      ["1.2.3-beta.any", true],
      ["1.2.3", true],
      ["1.2.4-alpha", true],
    ] as const) {
      expect(admitted(access("1.2.3-beta.10+build"), "cli", actual)).toBe(expected)
    }
    expect(admitted(access("1.2.3"), "cli", "1.2.3-rc.9")).toBe(false)
    expect(admitted(access("1.2.3-9007199254740993"), "cli", "1.2.3-9007199254740992")).toBe(false)
    expect(admitted(access("9999999999999999999.0.0"), "cli", "10000000000000000000.0.0")).toBe(true)
    const blocked = policy("client_access", { schema_version: 1, mode: "blocklist", clients: [{ feature: "desktop" }] })
    expect(admitted(blocked, undefined, undefined)).toBe(true)
    expect(admitted(blocked, "unknown", undefined)).toBe(true)
    expect(admitted(blocked, "desktop", undefined)).toBe(false)
    expect(admitted(layered, "cli", undefined)).toBe(false)
  })

  test("rejects unsupported and unbounded documents without dropping rules or layers", () => {
    const agent = (...layers: unknown[]) => ({ ...enabled, policy: { agent_permissions: { layers } } })
    const client = (...layers: unknown[]) => ({ ...enabled, policy: { client_access: { layers } } })
    const tools = (tools: unknown) => agent({ schema_version: 1, tools })
    const rules = Array.from({ length: 40 }, () => ({ pattern: "\u00e9".repeat(300), action: "allow" }))
    const bash = { fallback: "ask", rules }
    const layer = { schema_version: 1, shell: { bash } }
    const agents = Array.from({ length: 101 }, () => ({ schema_version: 1 }))
    expect(MemberPolicySchema.safeParse(agent(...agents)).success).toBe(true)
    expect(MemberPolicySchema.safeParse(agent(layer)).success).toBe(true)
    for (const data of [
      fixtures.invalid_future_version,
      { ...fixtures.layered, managed: false },
      { ...enabled, managed: null },
      { ...enabled, max_age_seconds: 0 },
      { ...enabled, max_age_seconds: 301 },
      { ...enabled, policy: { extra: {} } },
      { ...enabled, revision: 1.5 },
      agent(),
      agent(...agents, { schema_version: 1 }),
      agent(...Array.from({ length: 12 }, () => layer)),
      agent({ ...layer, shell: { bash, powershell: bash } }),
      agent({ schema_version: 1, shell: { bash: { fallback: "allow", rules: [] } } }),
      agent({ schema_version: 1, shell: { bash: { rules: [] } } }),
      agent({ schema_version: 1, shell: { cmd: bash } }),
      tools({ bash: { rules: [] } }),
      tools({ "tool with space": "allow" }),
      tools(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`tool${index}`, "allow"]))),
      tools({ edit: { rules: Array.from({ length: 101 }, () => ({ pattern: "*", action: "allow" })) } }),
      tools({ edit: { rules: [{ pattern: "a\u001fb", action: "allow" }] } }),
      tools({ edit: { rules: [{ pattern: " ", action: "allow" }] } }),
      tools({ edit: { rules: [{ pattern: "a".repeat(513), action: "allow" }] } }),
      client({ schema_version: 1, mode: "blocklist", clients: [{ feature: "cli", min_version: "1.2.3" }] }),
      client({ schema_version: 1, mode: "allowlist", clients: [{ feature: "unknown" }] }),
      client({ schema_version: 1, mode: "allowlist", clients: [{ feature: "cli" }, { feature: "cli" }] }),
      client({ schema_version: 1, mode: "allowlist", clients: [], unknown_clients: "allow" }),
    ]) {
      expect(MemberPolicySchema.safeParse(data).success).toBe(false)
    }
  })
})

describe("member policy fetch and cache", () => {
  test("reuses fresh disk entries after restart and renews only the exact opaque validator on 304", async () => {
    const seen: Array<string | null> = []
    using http = serve((req) => {
      expect(req.method).toBe("GET")
      expect(new URL(req.url).pathname).toBe(`/api/organizations/${org}/policy/permission`)
      expect(req.headers.get("authorization")).toBe("Bearer fixture-token")
      const conditional = req.headers.get("if-none-match")
      seen.push(conditional)
      return conditional === tag ? notModified(tag) : ok()
    })
    const disk = new Map<string, PolicyEntry>()
    const storage = {
      async read(key: string) {
        return disk.get(key)
      },
      async write(key: string, entry: PolicyEntry) {
        expect(key).toMatch(/^[a-f0-9]{64}$/)
        disk.set(key, JSON.parse(JSON.stringify(entry)))
      },
    }
    let clock = 1_000
    const now = () => clock
    const first = { status: "ok", entry: { policy: layered, etag: tag, validatedAt: clock } }
    expect(await createPolicyClient({ now, storage }).get(http.scope)).toEqual(first)
    clock += 299_999
    const restarted = createPolicyClient({ now, storage, maxAge: 600_000 })
    expect(await restarted.get(http.scope)).toEqual(first)
    expect(seen).toEqual([null])
    clock++
    const renewed = { status: "ok", entry: { policy: layered, etag: tag, validatedAt: clock } }
    expect(await Promise.all([restarted.get(http.scope), restarted.get(http.scope)])).toEqual([renewed, renewed])
    expect(seen).toEqual([null, tag])
    expect([...disk.values()]).toEqual([renewed.entry])
    expect(await createPolicyClient({ now, storage }).get(http.scope)).toEqual(renewed)
    expect(seen).toEqual([null, tag])
  })

  test("shortens freshness and refuses mismatched or unsolicited 304, authorization errors, and expired offline reuse", async () => {
    const tags: Array<string | null> = []
    const responses = [
      () => ok(),
      () => notModified(),
      () => notModified('"other"'),
      () => new Response(null, { status: 401 }),
      () => new Response(null, { status: 403 }),
      () => new Response(null, { status: 503 }),
      () => notModified(tag),
    ]
    using http = serve((req) => {
      tags.push(req.headers.get("if-none-match"))
      return responses.shift()?.() ?? new Response(null, { status: 500 })
    })
    let clock = 0
    const client = createPolicyClient({ now: () => clock, maxAge: 20 })
    expect((await client.get(http.scope)).status).toBe("ok")
    clock = 19
    expect((await client.get(http.scope)).status).toBe("ok")
    expect(tags).toEqual([null])
    clock = 20
    for (const reason of ["invalid-response", "invalid-response", "authorization", "authorization", "transport"]) {
      expect(await client.get(http.scope)).toEqual({ status: "unavailable", reason })
    }
    expect(await createPolicyClient().get(http.scope)).toEqual({ status: "unavailable", reason: "invalid-response" })
    expect(tags).toEqual([null, tag, tag, tag, tag, tag, null])
  })

  test("single-flights each scope and never shares a validator across credential, account, organization or origin", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const seen: Array<string | null> = []
    using http = serve(async (req) => {
      const id = new URL(req.url).pathname.split("/").at(3)
      seen.push(req.headers.get("if-none-match"))
      if (seen.length === 1) {
        entered.resolve()
        await release.promise
        return ok(layered)
      }
      return ok({ ...fixtures.disabled, organization_id: id, revision: layered.revision }, '"fresh"')
    })
    using origin = serve((req) => {
      expect(req.headers.get("if-none-match")).toBeNull()
      return ok(enabled, '"other-origin"')
    })
    const client = createPolicyClient({ now: () => 100 })
    const pending = client.get(http.scope)
    try {
      await entered.promise
      const duplicate = client.get(http.scope)
      const account = await client.get({ ...http.scope, account: "second-account" })
      const token = await client.get({ ...http.scope, token: "second-token" })
      const organization = await client.get({ ...http.scope, organization: other })
      const isolated = await client.get({ ...http.scope, origin: origin.scope.origin })
      expect(account).toMatchObject({ status: "ok", entry: { policy: { managed: false } } })
      expect(token).toEqual(account)
      expect(organization).toMatchObject({ status: "ok", entry: { policy: { organization_id: other } } })
      expect(isolated).toMatchObject({ status: "ok", entry: { etag: '"other-origin"' } })
      expect(seen).toEqual([null, null, null, null])
      release.resolve()
      expect(await pending).toMatchObject({ status: "ok", entry: { etag: tag } })
      expect(await duplicate).toEqual(await pending)
      expect(await client.get({ ...http.scope, organization: other })).toEqual(organization)
      expect(seen).toHaveLength(4)
    } finally {
      release.resolve()
    }
  })

  test("requires valid tags, scoped strict envelopes, and bounded UTF-8 response streams", async () => {
    const invalid = [
      () => Response.json(layered),
      () => ok(layered, "12"),
      () => ok(layered, "*"),
      () => ok(layered, 'W/"weak"'),
      () => ok(layered, '"first", "second"'),
      () => ok({ ...enabled, organization_id: other }),
      () => ok({ ...enabled, managed: null }),
      () => new Response("{", { headers: { etag: tag } }),
      () => new Response(Uint8Array.of(0xc3, 0x28), { headers: { etag: tag } }),
      () => new Response(" ".repeat(262145), { headers: { etag: tag } }),
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(enabled)))
              controller.enqueue(new Uint8Array(256 * 1024).fill(32))
              controller.close()
            },
          }),
          { headers: { etag: tag } },
        ),
    ]
    const future = [
      fixtures.invalid_future_version,
      { ...enabled, policy: { agent_permissions: { layers: [{ schema_version: 2 }] } } },
      { ...enabled, policy: { client_access: { layers: [{ schema_version: 2, mode: "blocklist", clients: [] }] } } },
    ]
    using http = serve(() => invalid.shift()?.() ?? ok(future.shift()))
    const client = createPolicyClient()
    for (const _ of Array.from(invalid)) {
      expect(await client.get(http.scope)).toEqual({ status: "unavailable", reason: "invalid-response" })
    }
    for (const _ of Array.from(future)) {
      expect(await client.get(http.scope)).toEqual({ status: "unavailable", reason: "unsupported-version" })
    }
  })

  test("does not follow redirects or use malformed persisted cache entries", async () => {
    let hits = 0
    using target = serve(() => {
      hits++
      return ok()
    })
    using source = serve((req) => {
      expect(req.headers.get("if-none-match")).toBeNull()
      return Response.redirect(target.scope.origin, 302)
    })
    for (const value of [
      { policy: fixtures.disabled, etag: tag, validatedAt: 101 },
      { policy: fixtures.disabled, etag: "0", validatedAt: 100 },
      { policy: { ...enabled, organization_id: other }, etag: tag, validatedAt: 100 },
      { policy: fixtures.invalid_future_version, etag: tag, validatedAt: 100 },
    ]) {
      const client = createPolicyClient({
        now: () => 100,
        storage: {
          async read() {
            return value
          },
          async write() {
            throw new Error("Unexpected write")
          },
        },
      })
      expect(await client.get(source.scope)).toEqual({ status: "unavailable", reason: "invalid-response" })
    }
    expect(hits).toBe(0)
  })

  test("treats transport timeout as unavailable and permits only a subsequent valid disabled response", async () => {
    const release = Promise.withResolvers<void>()
    using delayed = serve(async () => {
      await release.promise
      return ok()
    })
    using disabled = serve(() => ok(fixtures.disabled))
    try {
      expect(await createPolicyClient({ timeout: 30 }).get(delayed.scope)).toEqual({
        status: "unavailable",
        reason: "transport",
      })
      expect(await createPolicyClient().get(disabled.scope)).toMatchObject({
        status: "ok",
        entry: { policy: { managed: false } },
      })
    } finally {
      release.resolve()
    }
  })
})
