import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { Effect } from "effect"
import { launch } from "../src/interactive-server"
import { createPrivacyStore } from "../src/privacy-settings"
import type { Layout } from "../src/paths"
import type { CredentialWriter, ImportCredential } from "../src/credential-import"
import {
  applyV1Import,
  importV1Config,
  planV1Import,
  reportV1Import,
  type ImportClient,
  type ImportIntegrationInfo,
} from "../src/import-v1-config"

function makeLayout(root: string): Layout {
  const paths = {
    home: os.homedir(),
    data: path.join(root, "data"),
    config: path.join(root, "config"),
    cache: path.join(root, "cache"),
    state: path.join(root, "state"),
    tmp: path.join(root, "tmp"),
    bin: path.join(root, "cache", "bin"),
    log: path.join(root, "data", "log"),
    repos: path.join(root, "data", "repos"),
  }
  return {
    channel: "interactive",
    paths,
    roots: [paths.data, paths.cache, paths.config, paths.state, paths.tmp],
    database: path.join(paths.data, "kilo2.db"),
    config: path.join(paths.config, "kilo.jsonc"),
    tuiConfig: path.join(paths.config, "tui.json"),
    telemetryConfig: path.join(paths.config, "telemetry.json"),
    password: path.join(paths.state, "server.password"),
    pty: path.join(paths.tmp, "pty"),
  }
}

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-import-test-"))
  const layout = makeLayout(root)
  const source = path.join(root, "source")
  await mkdir(source, { recursive: true })
  return {
    root,
    layout,
    source,
    write: async (name: string, value: unknown) => {
      const file = path.join(source, name)
      await writeFile(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`)
      return file
    },
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

function stubClient(
  integrations: ImportIntegrationInfo[],
  calls: Array<{ integrationID: string; key: string; label?: string }> = [],
): ImportClient {
  return {
    integration: {
      list: async () => ({ data: integrations }),
      wellknown: {
        add: async () => {},
      },
      connect: {
        key: async (input) => {
          calls.push(input)
        },
      },
    },
  }
}

const keyIntegration = (id: string, overrides: Partial<ImportIntegrationInfo> = {}): ImportIntegrationInfo => ({
  id,
  methods: [{ type: "key" }],
  connections: [],
  ...overrides,
})

test("plans api-key credentials with v1 trailing-slash normalization", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    anthropic: { type: "api", key: "sk-ant-fixture" },
    "openai/": { type: "api", key: "sk-openai-fixture" },
  })
  const plan = await planV1Import({ auth })
  expect(plan.credentials).toEqual([
    {
      source: "anthropic",
      kind: "api-key",
      supported: true,
      integrationID: "anthropic",
      key: "sk-ant-fixture",
      label: "Imported from v1",
    },
    {
      source: "openai/",
      kind: "api-key",
      supported: true,
      integrationID: "openai",
      key: "sk-openai-fixture",
      label: "Imported from v1",
    },
  ])
  expect(plan.configKeys).toEqual([])
})

test("plans Kilo OAuth only with an explicit server and preserves its selected organization", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    kilo: {
      type: "oauth",
      refresh: "refresh-fixture",
      access: "access-fixture",
      expires: 1_000,
      accountId: "11111111-1111-4111-8111-111111111111",
    },
    "github-copilot": { type: "oauth", refresh: "r", access: "a", expires: 1, enterpriseUrl: "enterprise.example" },
  })
  const plan = await planV1Import({ auth, gatewayServer: "http://127.0.0.1:4010" })
  const kilo = plan.credentials[0]
  const copilot = plan.credentials[1]
  expect(kilo.supported).toBe(true)
  if (!kilo.supported) return
  expect(kilo.kind).toBe("oauth")
  expect(kilo).toMatchObject({
    integrationID: "kilo",
    methodID: "device",
    server: "http://127.0.0.1:4010",
    organizationID: "11111111-1111-4111-8111-111111111111",
  })
  expect(copilot).toMatchObject({
    supported: true,
    integrationID: "github-copilot",
    methodID: "device",
    metadata: { enterpriseUrl: "enterprise.example" },
  })
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("enterprise.example")
})

test("plans only provider-proven OAuth metadata and preserves token fields", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    openai: { type: "oauth", refresh: "openai-refresh", access: "openai-access", expires: 1, accountId: "acct_123" },
    "github-copilot": { type: "oauth", refresh: "copilot-refresh", access: "copilot-access", expires: 2 },
    xai: { type: "oauth", refresh: "xai-refresh", access: "xai-access", expires: 3 },
    "openai-extra": {
      type: "oauth",
      refresh: "r",
      access: "a",
      expires: 1,
      accountId: "account",
      enterpriseUrl: "unsupported.example",
    },
    "github-copilot/": {
      type: "oauth",
      refresh: "r",
      access: "a",
      expires: 1,
      accountId: "unsupported-account",
    },
    "xai/": { type: "oauth", refresh: "r", access: "a", expires: 1, enterpriseUrl: "unsupported.example" },
    opencode: { type: "oauth", refresh: "r", access: "a", expires: 1 },
  })
  const plan = await planV1Import({ auth })
  expect(plan.credentials.slice(0, 3)).toEqual([
    {
      source: "openai",
      kind: "oauth",
      supported: true,
      integrationID: "openai",
      methodID: "chatgpt-browser",
      refresh: "openai-refresh",
      access: "openai-access",
      expires: 1,
      metadata: { accountID: "acct_123" },
      label: "Imported from v1",
    },
    {
      source: "github-copilot",
      kind: "oauth",
      supported: true,
      integrationID: "github-copilot",
      methodID: "device",
      refresh: "copilot-refresh",
      access: "copilot-access",
      expires: 2,
      label: "Imported from v1",
    },
    {
      source: "xai",
      kind: "oauth",
      supported: true,
      integrationID: "xai",
      methodID: "device",
      refresh: "xai-refresh",
      access: "xai-access",
      expires: 3,
      label: "Imported from v1",
    },
  ])
  expect(plan.credentials.slice(3).map((entry) => [entry.source, entry.supported, entry.kind])).toEqual([
    ["openai-extra", false, "oauth"],
    ["github-copilot/", false, "oauth"],
    ["xai/", false, "oauth"],
    ["opencode", false, "oauth"],
  ])
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("openai-refresh")
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("unsupported.example")
})

test("refuses invalid Kilo account IDs and keeps an absent account ID as personal", async () => {
  await using input = await sandbox()
  const invalid = await input.write("invalid.json", {
    kilo: { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "not-a-uuid" },
  })
  const invalidPlan = await planV1Import({ auth: invalid, gatewayServer: "http://127.0.0.1:4010" })
  expect(invalidPlan.credentials[0]).toMatchObject({ supported: false, reason: "Kilo OAuth accountId must be a UUID" })

  const personal = await input.write("personal.json", {
    kilo: { type: "oauth", refresh: "r", access: "a", expires: 1 },
  })
  const personalPlan = await planV1Import({ auth: personal, gatewayServer: "http://127.0.0.1:4010" })
  expect(personalPlan.credentials[0]).toMatchObject({ supported: true, organizationID: null })
})

test("plans metadata-bearing API and well-known credentials for the host writer", async () => {
  await using input = await sandbox()
  const auth = await input.write(
    "auth.json",
    JSON.stringify({
      "https://wellknown.example/": { type: "wellknown", key: "TOKEN", token: "wellknown-token-secret" },
      xai: { type: "api", key: "kilo-oauth-dummy-key" },
      snowflake: { type: "api", key: "k", metadata: { region: "us-east-1" } },
      broken: { type: "api" },
    }),
  )
  const plan = await planV1Import({ auth })
  expect(plan.credentials.map((entry) => [entry.source, entry.kind, entry.supported])).toEqual([
    ["https://wellknown.example/", "wellknown", true],
    ["xai", "api-key", false],
    ["snowflake", "api-key", true],
    ["broken", "unknown", false],
  ])
  const wellknown = plan.credentials[0]
  expect(wellknown).toMatchObject({
    integrationID: "https://wellknown.example",
    environmentKey: "TOKEN",
    token: "wellknown-token-secret",
  })
  const metadata = plan.credentials[2]
  expect(metadata).toMatchObject({ metadata: { region: "us-east-1" } })
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("us-east-1")
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("wellknown-token-secret")
})

test("requires the host writer for metadata API keys without exposing metadata to reports", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    anthropic: { type: "api", key: "sk-fixture", metadata: { region: "us-east-1" } },
  })
  const plan = await planV1Import({ auth })
  const missing = await applyV1Import({ layout: input.layout, client: stubClient([keyIntegration("anthropic")]), plan })
  expect(missing).toMatchObject({ status: "refused", reason: "Credential import requires the host credential writer" })

  const writes: ImportCredential[] = []
  const writer: CredentialWriter = async (credential) => {
    writes.push(credential)
  }
  const applied = await applyV1Import({
    layout: input.layout,
    client: stubClient([keyIntegration("anthropic")]),
    writeCredential: writer,
    plan,
  })
  expect(applied.status).toBe("applied")
  expect(writes).toEqual([
    {
      kind: "api-key",
      integrationID: "anthropic",
      key: "sk-fixture",
      metadata: { region: "us-east-1" },
      label: "Imported from v1",
    },
  ])
  expect(JSON.stringify(reportV1Import(applied))).not.toContain("us-east-1")
})

test("imports Kilo OAuth only through the exact device method and host writer", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    kilo: {
      type: "oauth",
      refresh: "refresh-fixture",
      access: "access-fixture",
      expires: 1_000,
    },
  })
  const plan = await planV1Import({ auth, gatewayServer: "http://127.0.0.1:4010" })
  const writes: ImportCredential[] = []
  const writer: CredentialWriter = async (credential) => {
    writes.push(credential)
  }
  const noDevice = await applyV1Import({
    layout: input.layout,
    client: stubClient([{ id: "kilo", methods: [{ id: "browser", type: "oauth" }], connections: [] }]),
    writeCredential: writer,
    plan,
  })
  expect(noDevice).toMatchObject({ status: "refused", reason: 'Integration "kilo" has no OAuth method "device"' })
  const applied = await applyV1Import({
    layout: input.layout,
    client: stubClient([{ id: "kilo", methods: [{ id: "device", type: "oauth" }], connections: [] }]),
    writeCredential: writer,
    plan,
  })
  expect(applied.status).toBe("applied")
  expect(writes).toEqual([
    {
      kind: "kilo-oauth",
      integrationID: "kilo",
      methodID: "device",
      refresh: "refresh-fixture",
      access: "access-fixture",
      expires: 1_000,
      server: "http://127.0.0.1:4010",
      organizationID: null,
      label: "Imported from v1",
    },
  ])
  expect(JSON.stringify(reportV1Import(applied))).not.toContain("refresh-fixture")
})

test("imports only the exact inventory methods for proven provider OAuth", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    openai: { type: "oauth", refresh: "openai-refresh", access: "openai-access", expires: 1, accountId: "acct_123" },
    "github-copilot": {
      type: "oauth",
      refresh: "copilot-refresh",
      access: "copilot-access",
      expires: 2,
      enterpriseUrl: "enterprise.example",
    },
    xai: { type: "oauth", refresh: "xai-refresh", access: "xai-access", expires: 3 },
  })
  const plan = await planV1Import({ auth })
  const writes: ImportCredential[] = []
  const writer: CredentialWriter = async (credential) => {
    writes.push(credential)
  }
  const missing = await applyV1Import({
    layout: input.layout,
    client: stubClient([
      { id: "openai", methods: [{ id: "chatgpt-headless", type: "oauth" }], connections: [] },
      { id: "github-copilot", methods: [{ id: "device", type: "oauth" }], connections: [] },
      { id: "xai", methods: [{ id: "device", type: "oauth" }], connections: [] },
    ]),
    writeCredential: writer,
    plan,
  })
  expect(missing).toMatchObject({
    status: "refused",
    reason: 'Integration "openai" has no OAuth method "chatgpt-browser"',
  })
  const applied = await applyV1Import({
    layout: input.layout,
    client: stubClient([
      { id: "openai", methods: [{ id: "chatgpt-browser", type: "oauth" }], connections: [] },
      { id: "github-copilot", methods: [{ id: "device", type: "oauth" }], connections: [] },
      { id: "xai", methods: [{ id: "device", type: "oauth" }], connections: [] },
    ]),
    writeCredential: writer,
    plan,
  })
  expect(applied.status).toBe("applied")
  expect(writes).toEqual([
    {
      kind: "oauth",
      integrationID: "openai",
      methodID: "chatgpt-browser",
      refresh: "openai-refresh",
      access: "openai-access",
      expires: 1,
      metadata: { accountID: "acct_123" },
      label: "Imported from v1",
    },
    {
      kind: "oauth",
      integrationID: "github-copilot",
      methodID: "device",
      refresh: "copilot-refresh",
      access: "copilot-access",
      expires: 2,
      metadata: { enterpriseUrl: "enterprise.example" },
      label: "Imported from v1",
    },
    {
      kind: "oauth",
      integrationID: "xai",
      methodID: "device",
      refresh: "xai-refresh",
      access: "xai-access",
      expires: 3,
      label: "Imported from v1",
    },
  ])
})

test("reports fixed generic validation diagnostics without echoing malformed input", async () => {
  await using input = await sandbox()
  const auth = await input.write(
    "auth.json",
    JSON.stringify({ broken: { type: "api", key: { leak: "sk-embedded-secret" } } }),
  )
  const plan = await planV1Import({ auth })
  const broken = plan.credentials[0]
  expect(broken.supported).toBe(false)
  if (broken.supported) return
  expect(broken.reason).toBe("Entry does not match the v1 credential schema")
  expect(JSON.stringify(plan.sources)).not.toContain("sk-embedded-secret")
  expect(JSON.stringify(reportV1Import(plan))).not.toContain("sk-embedded-secret")
  const config = await input.write("kilo.json", JSON.stringify({ permission: { write: { deep: "sk-config-secret" } } }))
  await expect(planV1Import({ config })).rejects.toThrow("does not match the v1 configuration schema")
  await expect(planV1Import({ config })).rejects.not.toThrow("sk-config-secret")
})

test("plans proven config mappings and reports unmapped Kilo-only keys", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", {
    $schema: "https://app.kilo.ai/config.json",
    model: "anthropic/claude-x",
    autoupdate: false,
    autoshare: true,
    username: "fixture-user",
    default_agent: "build",
    small_model: "anthropic/claude-haiku",
    logLevel: "WARN",
    indexing: { enabled: true },
    privacy_mode: true,
  })
  const plan = await planV1Import({ config })
  const supported = plan.configKeys.filter((key) => key.supported).map((key) => key.key)
  expect([...supported].sort()).toEqual(
    ["$schema", "autoupdate", "autoshare", "default_agent", "model", "small_model", "username", "privacy_mode"].sort(),
  )
  const unmapped = plan.configKeys.filter((key) => !key.supported)
  expect(unmapped.map((key) => key.key).sort()).toEqual(["indexing", "logLevel"].sort())
  expect(unmapped.find((key) => key.key === "logLevel")?.reason).toContain("not carried")
  expect(unmapped.find((key) => key.key === "indexing")?.paths).toContain("indexing.enabled")
  expect(plan.config.model).toEqual({ providerID: "anthropic", model: "claude-x" })
  expect(plan.config.update).toBe("disable")
  expect(plan.config.share).toBe("auto")
  expect(plan.config.username).toBe("fixture-user")
  expect(plan.config.default_agent).toBe("build")
  const agents = plan.config.agents as { title?: { model?: unknown } } | undefined
  expect(agents?.title?.model).toEqual({ providerID: "anthropic", model: "claude-haiku" })
})

test("treats Kilo v1 null model keys as explicitly unset and keeps the import unblocked", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", { model: null, small_model: null, username: "u" })
  const plan = await planV1Import({ config })
  expect(plan.config).toEqual({ username: "u" })
  expect(plan.configKeys.find((key) => key.key === "model")?.supported).toBe(true)
  expect(plan.configKeys.find((key) => key.key === "small_model")?.supported).toBe(true)
})

test("accepts JSONC v1 config sources with comments and trailing commas", async () => {
  await using input = await sandbox()
  const jsonc = await input.write(
    "kilo.jsonc",
    `{
  // provider comment
  /* block comment */
  "username": "fixture-user",  // trailing comment
  "model": "anthropic/claude-x",
  "instructions": [
    "a.txt",
  ],
}`,
  )
  const plan = await planV1Import({ config: jsonc })
  expect(plan.config.username).toBe("fixture-user")
  expect(plan.config.model).toEqual({ providerID: "anthropic", model: "claude-x" })
  expect(plan.config.instructions).toEqual(["a.txt"])
  const urlComment = await input.write("urls.jsonc", '{ "enterprise": { "url": "https://x.test//not-a-comment" } }')
  const urls = await planV1Import({ config: urlComment })
  expect((urls.config.enterprise as { url: string }).url).toBe("https://x.test//not-a-comment")
})

test("refuses malformed v1 sources with fixed generic diagnostics", async () => {
  await using input = await sandbox()
  const unterminated = await input.write("kilo.jsonc", '{ /* never closed "username": "u" }')
  await expect(planV1Import({ config: unterminated })).rejects.toThrow("not a valid JSON or JSONC object")
  const badString = await input.write("broken.json", '{ "username": "unterminated }')
  await expect(planV1Import({ config: badString })).rejects.toThrow("not a valid JSON or JSONC object")
  const array = await input.write("auth.json", '["not-an-object"]')
  await expect(planV1Import({ auth: array })).rejects.toThrow("not a valid JSON or JSONC object")
  await expect(planV1Import({})).rejects.toThrow("Specify a v1 auth.json file")
})

test("reports silently dropped nested v1 paths instead of claiming key support", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", {
    experimental: { subagent_depth: 2, disable_paste_summary: true, batch_tool: true },
    compaction: { auto: true, tail_turns: 3 },
  })
  const plan = await planV1Import({ config })
  const experimental = plan.configKeys.find((key) => key.key === "experimental")
  const compaction = plan.configKeys.find((key) => key.key === "compaction")
  expect(experimental?.supported).toBe(false)
  if (experimental && !experimental.supported) {
    expect(experimental.paths).toContain("experimental.disable_paste_summary")
    expect(experimental.paths).toContain("experimental.batch_tool")
    expect(experimental.paths).not.toContain("experimental.subagent_depth")
  }
  expect(compaction?.supported).toBe(false)
  if (compaction && !compaction.supported) expect(compaction.paths).toContain("compaction.tail_turns")
})

test("projections expose no credential or config secret material", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    anthropic: { type: "api", key: "sk-ant-fixture-secret" },
    kilo: {
      type: "oauth",
      refresh: "refresh-fixture-secret",
      access: "access-fixture-secret",
      expires: 1,
      accountId: "org-fixture",
    },
  })
  const config = await input.write("kilo.json", {
    username: "u",
    provider: { secretprov: { options: { apiKey: "config-embedded-secret" } } },
  })
  const plan = await planV1Import({ auth, config })
  const report = reportV1Import(plan)
  const serialized = JSON.stringify(report)
  expect(serialized).not.toContain("sk-ant-fixture-secret")
  expect(serialized).not.toContain("refresh-fixture-secret")
  expect(serialized).not.toContain("access-fixture-secret")
  expect(serialized).not.toContain("config-embedded-secret")
  expect(report.sources.auth).toEqual(plan.sources.auth)
  expect(Object.keys(report.sources.auth ?? {})).toEqual(["path", "bytes", "sha256"])
  const planned = reportV1Import(plan)
  expect(planned.status).toBeUndefined()
  const supported = report.credentials.find((entry) => entry.source === "anthropic")
  expect(supported).toEqual({
    source: "anthropic",
    kind: "api-key",
    supported: true,
    integrationID: "anthropic",
    label: "Imported from v1",
  })
})

test("rejects non-regular and oversized v1 sources instead of hanging", async () => {
  await using input = await sandbox()
  await expect(planV1Import({ auth: input.source })).rejects.toThrow("must be a regular file")
  if (process.platform !== "win32") {
    const fifo = path.join(input.source, "pipe")
    Bun.spawnSync(["mkfifo", fifo])
    await expect(planV1Import({ auth: fifo })).rejects.toThrow("must be a regular file")
  }
  const oversized = path.join(input.source, "big.json")
  await Bun.write(oversized, new Uint8Array(10 * 1024 * 1024 + 1))
  await expect(planV1Import({ config: oversized })).rejects.toThrow("at most 10 MiB")
})

test("runs preflight before any target read or credential call", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const config = await input.write("kilo.json", { username: "u" })
  const plan = await planV1Import({ auth, config })
  const calls: unknown[] = []
  const hostile: ImportClient = {
    integration: {
      list: async () => {
        calls.push("list")
        return { data: [keyIntegration("anthropic")] }
      },
      wellknown: {
        add: async () => {},
      },
      connect: {
        key: async (request) => {
          calls.push(request)
        },
      },
    },
  }
  const protectedLayout: Layout = {
    ...input.layout,
    config: path.join(os.homedir(), ".config", "kilo", "kilo.jsonc"),
  }
  await expect(applyV1Import({ layout: protectedLayout, client: hostile, plan })).rejects.toThrow(
    "Refusing a protected",
  )
  expect(calls).toEqual([])
})

test("writes the migrated config atomically and privately into the isolated profile", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", { model: "anthropic/claude-x", username: "u" })
  const plan = await planV1Import({ config })
  const result = await applyV1Import({ layout: input.layout, plan })
  expect(result.status).toBe("applied")
  if (result.status !== "applied") return
  expect([...result.configKeys].sort()).toEqual(["model", "username"])
  expect(result.credentials).toEqual([])
  const written = await Bun.file(input.layout.config).json()
  expect(written).toEqual({ model: { providerID: "anthropic", model: "claude-x" }, username: "u" })
  const mode = (await stat(input.layout.config)).mode & 0o777
  expect(mode).toBe(0o600)
  expect(await readdir(path.dirname(input.layout.config))).toEqual(["kilo.jsonc"])
})

test("merges into an existing profile config and preserves unrelated keys", async () => {
  await using input = await sandbox()
  await mkdir(input.layout.paths.config, { recursive: true })
  const existing = path.join(input.layout.paths.config, "kilo.jsonc")
  await writeFile(existing, JSON.stringify({ shell: "/bin/zsh" }, null, 2))
  const config = await input.write("kilo.json", { username: "u" })
  const plan = await planV1Import({ config })
  const result = await applyV1Import({ layout: input.layout, plan })
  expect(result.status).toBe("applied")
  const written = await Bun.file(existing).json()
  expect(written).toEqual({ shell: "/bin/zsh", username: "u" })
})

test("refuses config overwrite conflicts by default and leaves the existing file untouched", async () => {
  await using input = await sandbox()
  await mkdir(input.layout.paths.config, { recursive: true })
  const existing = path.join(input.layout.paths.config, "kilo.jsonc")
  await writeFile(existing, '{"model": "openai/gpt-x"}')
  const before = await Bun.file(existing).bytes()
  const config = await input.write("kilo.json", { model: "anthropic/claude-x" })
  const plan = await planV1Import({ config })
  const result = await applyV1Import({ layout: input.layout, plan })
  expect(result.status).toBe("refused")
  if (result.status !== "refused") return
  expect(result.reason).toContain('Config key "model" already set')
  expect(await Bun.file(existing).bytes()).toEqual(before)
  expect(await readdir(input.layout.paths.config)).toEqual(["kilo.jsonc"])
})

test("overwrites conflicting config keys only with the explicit allowOverwrite option", async () => {
  await using input = await sandbox()
  await mkdir(input.layout.paths.config, { recursive: true })
  const existing = path.join(input.layout.paths.config, "kilo.jsonc")
  await writeFile(existing, '{"model": "openai/gpt-x", "shell": "/bin/zsh"}')
  const config = await input.write("kilo.json", { model: "anthropic/claude-x" })
  const plan = await planV1Import({ config })
  const result = await applyV1Import({ layout: input.layout, plan, allowOverwrite: true })
  expect(result.status).toBe("applied")
  const written = await Bun.file(existing).json()
  expect(written.model).toEqual({ providerID: "anthropic", model: "claude-x" })
  expect(written.shell).toBe("/bin/zsh")
})

test.each([true, false])(
  "imports the Kilo privacy bit consumed by the isolated privacy store (%s)",
  async (enabled) => {
    await using input = await sandbox()
    const config = await input.write("kilo.json", { privacy_mode: enabled })
    const before = await Bun.file(config).text()
    const plan = await planV1Import({ config })
    expect(plan.configKeys).toEqual([{ key: "privacy_mode", supported: true }])
    expect(await applyV1Import({ layout: input.layout, plan })).toMatchObject({ status: "applied" })
    expect(await createPrivacyStore({ layout: input.layout }).read()).toEqual({ enabled, scope: "profile" })
    expect(await Bun.file(config).text()).toBe(before)
  },
)

test("refuses an invalid privacy value without reflecting its contents", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", { privacy_mode: "sk-private-value" })
  await expect(planV1Import({ config })).rejects.toThrow(`${config} does not match the v1 configuration schema`)
  expect(await Bun.file(input.layout.config).exists()).toBe(false)
})

test("refuses unmapped config keys by default and imports the mapped subset only with allowUnmapped", async () => {
  await using input = await sandbox()
  const config = await input.write("kilo.json", { username: "u", indexing: { enabled: true } })
  const plan = await planV1Import({ config })
  const refused = await applyV1Import({ layout: input.layout, plan })
  expect(refused.status).toBe("refused")
  if (refused.status !== "refused") return
  expect(refused.reason).toContain("indexing")
  expect(await Bun.file(input.layout.config).exists()).toBe(false)
  const allowed = await applyV1Import({ layout: input.layout, plan, allowUnmapped: true })
  expect(allowed.status).toBe("applied")
  expect(await Bun.file(input.layout.config).json()).toEqual({ username: "u" })
})

test("refuses the whole import when any credential is unsupported, applying nothing", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", {
    anthropic: { type: "api", key: "sk-ant-fixture" },
    kilo: { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "11111111-1111-4111-8111-111111111111" },
  })
  const config = await input.write("kilo.json", { username: "u" })
  const plan = await planV1Import({ auth, config })
  const calls: Array<{ integrationID: string; key: string; label?: string }> = []
  const result = await applyV1Import({
    layout: input.layout,
    client: stubClient([keyIntegration("anthropic")], calls),
    plan,
  })
  expect(result.status).toBe("refused")
  if (result.status !== "refused") return
  expect(result.reason).toContain('"kilo"')
  const kilo = result.plan.credentials.find((entry) => entry.source === "kilo")
  expect(kilo?.supported).toBe(false)
  if (kilo && !kilo.supported) expect(kilo.reason).toContain("explicit gateway server")
  expect(calls).toEqual([])
  expect(await Bun.file(input.layout.config).exists()).toBe(false)
})

test("refuses credentials for integrations that are missing or lack a key method", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const plan = await planV1Import({ auth })
  const missing = await applyV1Import({ layout: input.layout, client: stubClient([]), plan })
  expect(missing.status).toBe("refused")
  if (missing.status !== "refused") return
  expect(missing.reason).toContain("not registered")
  const noKeyMethod = await applyV1Import({
    layout: input.layout,
    client: stubClient([{ id: "anthropic", methods: [{ type: "oauth" }], connections: [] }]),
    plan,
  })
  expect(noKeyMethod.status).toBe("refused")
  if (noKeyMethod.status !== "refused") return
  expect(noKeyMethod.reason).toContain("no key authentication method")
})

test("refuses credential overwrite conflicts by default and connects with allowOverwrite", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const plan = await planV1Import({ auth })
  const calls: Array<{ integrationID: string; key: string; label?: string }> = []
  const existing: ImportIntegrationInfo = {
    id: "anthropic",
    methods: [{ type: "key" }],
    connections: [{ type: "credential" }],
  }
  const refused = await applyV1Import({ layout: input.layout, client: stubClient([existing], calls), plan })
  expect(refused.status).toBe("refused")
  expect(calls).toEqual([])
  const allowed = await applyV1Import({
    layout: input.layout,
    client: stubClient([existing], calls),
    plan,
    allowOverwrite: true,
  })
  expect(allowed.status).toBe("applied")
  expect(calls).toEqual([{ integrationID: "anthropic", key: "sk-ant-fixture", label: "Imported from v1" }])
})

test("reports a failed credential apply honestly without echoing server errors", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const config = await input.write("kilo.json", { username: "u" })
  const plan = await planV1Import({ auth, config })
  const client: ImportClient = {
    integration: {
      list: async () => ({ data: [keyIntegration("anthropic")] }),
      wellknown: {
        add: async () => {},
      },
      connect: {
        key: async (request) => {
          throw new Error(`Invalid API key "${request.key}" for ${request.integrationID}`)
        },
      },
    },
  }
  const result = await applyV1Import({ layout: input.layout, client, plan })
  expect(result.status).toBe("failed")
  if (result.status !== "failed") return
  expect(result.reason).toBe(
    'Credential for "anthropic" could not be imported: the profile server rejected or could not process the request',
  )
  expect(result.reason).not.toContain("sk-ant-fixture")
  expect(JSON.stringify(reportV1Import(result))).not.toContain("sk-ant-fixture")
  expect(result.appliedCredentials).toEqual([])
  expect(result.configWritten).toBe(true)
  expect(await Bun.file(input.layout.config).exists()).toBe(true)
})

test("preserves the v1 source files byte-identical and records their hashes", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const config = await input.write("kilo.json", { username: "u" })
  const authBefore = await Bun.file(auth).bytes()
  const configBefore = await Bun.file(config).bytes()
  const plan = await planV1Import({ auth, config })
  expect(plan.sources.auth?.sha256).toBe(new Bun.CryptoHasher("sha256").update(authBefore).digest("hex"))
  expect(plan.sources.auth?.bytes).toBe(authBefore.byteLength)
  await applyV1Import({ layout: input.layout, client: stubClient([keyIntegration("anthropic")]), plan })
  expect(await Bun.file(auth).bytes()).toEqual(authBefore)
  expect(await Bun.file(config).bytes()).toEqual(configBefore)
})

test("imports through the live public client contract of an isolated profile", async () => {
  await using input = await sandbox()
  const auth = await input.write("auth.json", { anthropic: { type: "api", key: "sk-ant-fixture" } })
  const config = await input.write("kilo.json", { username: "fixture-user", model: "anthropic/claude-x" })
  const observed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* launch(input.layout, { models: false, recover: false })
        const client = createClient({
          baseUrl: server.url,
          headers: { authorization: `Basic ${btoa(`opencode:${server.auth.password}`)}` },
        })
        const integrations = (yield* Effect.promise(() => client.integration.list())).data
        const target = integrations.find(
          (integration) =>
            integration.methods.some((method) => method.type === "key" && !("form" in method && method.form)) &&
            integration.connections.length === 0,
        )
        expect(target).toBeDefined()
        const targetID = target?.id ?? ""
        yield* Effect.promise(() =>
          Bun.write(auth, JSON.stringify({ [targetID]: { type: "api", key: "sk-fixture-key" } })),
        )
        const result = yield* Effect.promise(() => importV1Config({ layout: input.layout, client, auth, config }))
        expect(result.status).toBe("applied")
        if (result.status !== "applied") return { targetID, result, connected: false }
        const after = (yield* Effect.promise(() => client.integration.list())).data
        const connected =
          after
            .find((integration) => integration.id === targetID)
            ?.connections.some((connection) => connection.type === "credential") ?? false
        return { targetID, result, connected }
      }),
    ),
  )
  expect(observed.result.status).toBe("applied")
  if (observed.result.status !== "applied") return
  expect(observed.result.credentials).toEqual([{ integrationID: observed.targetID, label: "Imported from v1" }])
  expect(observed.connected).toBe(true)
  const written = await Bun.file(input.layout.config).json()
  expect(written.username).toBe("fixture-user")
  expect(written.model).toEqual({ providerID: "anthropic", model: "claude-x" })
})

test("imports metadata API credentials through the isolated host-only writer", async () => {
  await using input = await sandbox()
  const observed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(input.layout, { models: false, recover: false })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: { authorization: `Basic ${btoa(`opencode:${endpoint.auth.password}`)}` },
        })
        yield* Effect.promise(() => client.plugin.awaitActivation({ location: { directory: input.root } }))
        const target = (yield* Effect.promise(() => client.integration.list())).data.find(
          (integration) =>
            integration.methods.some((method) => method.type === "key" && !("form" in method && method.form)) &&
            integration.connections.length === 0,
        )
        expect(target).toBeDefined()
        const auth = yield* Effect.promise(() =>
          input.write("auth.json", {
            [target?.id ?? ""]: { type: "api", key: "fixture-key", metadata: { region: "us-east-1" } },
          }),
        )
        const plan = yield* Effect.promise(() => planV1Import({ auth }))
        const result = yield* Effect.promise(() =>
          applyV1Import({ layout: input.layout, client, writeCredential: endpoint.importCredential, plan }),
        )
        const integration = (yield* Effect.promise(() => client.integration.list())).data.find(
          (item) => item.id === target?.id,
        )
        return {
          result,
          connected: integration?.connections.some((connection) => connection.type === "credential") ?? false,
        }
      }),
    ),
  )
  expect(observed.result.status).toBe("applied")
  expect(observed.connected).toBe(true)
})

test("imports OpenAI OAuth through the isolated public inventory and host writer", async () => {
  await using input = await sandbox()
  const observed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const endpoint = yield* launch(input.layout, { models: false, recover: false })
        const client = createClient({
          baseUrl: endpoint.url,
          headers: { authorization: `Basic ${btoa(`opencode:${endpoint.auth.password}`)}` },
        })
        const location = { directory: input.root }
        yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
        const openai = (yield* Effect.promise(() => client.integration.list({ location }))).data.find(
          (integration) => integration.id === "openai",
        )
        expect(openai?.methods.some((method) => method.type === "oauth" && method.id === "chatgpt-browser")).toBe(true)
        const auth = yield* Effect.promise(() =>
          input.write("auth.json", {
            openai: {
              type: "oauth",
              refresh: "refresh-fixture",
              access: "access-fixture",
              expires: 1,
              accountId: "acct_fixture",
            },
          }),
        )
        const plan = yield* Effect.promise(() => planV1Import({ auth }))
        const result = yield* Effect.promise(() =>
          applyV1Import({ layout: input.layout, client, writeCredential: endpoint.importCredential, location, plan }),
        )
        const connected = (yield* Effect.promise(() => client.integration.list({ location }))).data
          .find((integration) => integration.id === "openai")
          ?.connections.some((connection) => connection.type === "credential")
        return { result, connected: connected ?? false }
      }),
    ),
  )
  expect(observed.result.status).toBe("applied")
  expect(observed.connected).toBe(true)
})

test("imports Kilo OAuth through the isolated host writer and exact device integration", async () => {
  await using input = await sandbox()
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/profile") return new Response(null, { status: 404 })
      return Response.json({
        user: { email: "fixture@example.test" },
        organizations: [],
        selectedOrganizationId: null,
        hasPersonalAccount: true,
      })
    },
  })
  try {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* launch(input.layout, {
            gateway: { server: `http://127.0.0.1:${gateway.port}` },
            models: false,
            recover: false,
          })
          const client = createClient({
            baseUrl: endpoint.url,
            headers: { authorization: `Basic ${btoa(`opencode:${endpoint.auth.password}`)}` },
          })
          const location = { directory: input.root }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          const auth = yield* Effect.promise(() =>
            input.write("auth.json", {
              kilo: { type: "oauth", refresh: "refresh-fixture", access: "access-fixture", expires: 1 },
            }),
          )
          const plan = yield* Effect.promise(() =>
            planV1Import({ auth, gatewayServer: `http://127.0.0.1:${gateway.port}` }),
          )
          const result = yield* Effect.promise(() =>
            applyV1Import({ layout: input.layout, client, writeCredential: endpoint.importCredential, location, plan }),
          )
          const kilo = (yield* Effect.promise(() => client.integration.list({ location }))).data.find(
            (integration) => integration.id === "kilo",
          )
          return {
            result,
            hasDevice: kilo?.methods.some((method) => method.type === "oauth" && method.id === "device") ?? false,
            connected: kilo?.connections.some((connection) => connection.type === "credential") ?? false,
          }
        }),
      ),
    )
    if (observed.result.status !== "applied") throw new Error(observed.result.reason)
    expect(observed.hasDevice).toBe(true)
    expect(observed.connected).toBe(true)
  } finally {
    await gateway.stop(true)
  }
})

test("imports v1 well-known credentials through native discovery and the host writer", async () => {
  await using input = await sandbox()
  const wellknown = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/.well-known/opencode") return new Response(null, { status: 404 })
      return Response.json({ auth: { command: ["login"], env: "V1_TOKEN" } })
    },
  })
  try {
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const endpoint = yield* launch(input.layout, { models: false, recover: false })
          const client = createClient({
            baseUrl: endpoint.url,
            headers: { authorization: `Basic ${btoa(`opencode:${endpoint.auth.password}`)}` },
          })
          const location = { directory: input.root }
          yield* Effect.promise(() => client.plugin.awaitActivation({ location }))
          const origin = wellknown.url.origin
          const auth = yield* Effect.promise(() =>
            input.write("auth.json", {
              [`${origin}/`]: { type: "wellknown", key: "V1_TOKEN", token: "wellknown-secret" },
            }),
          )
          const plan = yield* Effect.promise(() => planV1Import({ auth }))
          const result = yield* Effect.promise(() =>
            applyV1Import({ layout: input.layout, client, writeCredential: endpoint.importCredential, location, plan }),
          )
          const integration = (yield* Effect.promise(() => client.integration.list({ location }))).data.find(
            (item) => item.id === origin,
          )
          return { result, integration }
        }),
      ),
    )
    expect(observed.result.status).toBe("applied")
    if (observed.result.status !== "applied") return
    expect(observed.result.wellKnownSources).toEqual([{ origin: wellknown.url.origin }])
    expect(observed.integration?.methods).toContainEqual({
      id: "login",
      type: "command",
      label: "Log in",
      command: ["login"],
    })
    expect(observed.integration?.connections.some((connection) => connection.type === "credential")).toBe(true)
    expect(JSON.stringify(reportV1Import(observed.result))).not.toContain("wellknown-secret")
  } finally {
    await wellknown.stop(true)
  }
})

test("refuses a v1 well-known token when the live manifest names another environment key", async () => {
  await using input = await sandbox()
  const wellknown = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ auth: { command: ["login"], env: "CURRENT_TOKEN" } }),
  })
  try {
    const auth = await input.write("auth.json", {
      [wellknown.url.origin]: { type: "wellknown", key: "V1_TOKEN", token: "wellknown-secret" },
    })
    const plan = await planV1Import({ auth })
    const calls: unknown[] = []
    const result = await applyV1Import({
      layout: input.layout,
      client: {
        integration: {
          list: async () => ({ data: [] }),
          wellknown: { add: async (request) => calls.push(request) },
          connect: { key: async () => {} },
        },
      },
      writeCredential: async () => {},
      plan,
    })
    expect(result.status).toBe("refused")
    if (result.status !== "refused") return
    expect(result.reason).toContain("does not expose the v1 authentication environment key")
    expect(calls).toEqual([])
    expect(JSON.stringify(reportV1Import(result))).not.toContain("wellknown-secret")
  } finally {
    await wellknown.stop(true)
  }
})

test("reports a discovered well-known source when its credential write fails", async () => {
  await using input = await sandbox()
  const wellknown = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ auth: { command: ["login"], env: "V1_TOKEN" } }),
  })
  try {
    const origin = wellknown.url.origin
    const auth = await input.write("auth.json", {
      [origin]: { type: "wellknown", key: "V1_TOKEN", token: "wellknown-secret" },
    })
    const plan = await planV1Import({ auth })
    let inventoryCalls = 0
    const result = await applyV1Import({
      layout: input.layout,
      client: {
        integration: {
          list: async () => {
            inventoryCalls += 1
            return {
              data:
                inventoryCalls === 1
                  ? []
                  : [{ id: origin, methods: [{ id: "login", type: "command" }], connections: [] }],
            }
          },
          wellknown: { add: async () => {} },
          connect: { key: async () => {} },
        },
      },
      writeCredential: async () => {
        throw new Error("credential rejected")
      },
      plan,
    })
    expect(result.status).toBe("failed")
    if (result.status !== "failed") return
    expect(result.wellKnownSources).toEqual([{ origin }])
    expect(reportV1Import(result).wellKnownSources).toEqual([{ origin }])
    expect(JSON.stringify(reportV1Import(result))).not.toContain("wellknown-secret")
  } finally {
    await wellknown.stop(true)
  }
})
