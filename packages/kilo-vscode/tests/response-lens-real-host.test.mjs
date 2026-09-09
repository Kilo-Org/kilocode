import assert from "node:assert/strict"
import { test } from "node:test"
import { request } from "node:http"
import { once } from "node:events"
import { serve, sanitize } from "./response-lens-real-host-server.mjs"
import { prepare, cleanup, inside, defaults } from "./response-lens-real-host-isolation.mjs"

test("loopback provider streams bounded deterministic completions and rejects fallback models", async () => {
  const server = await serve(6000)
  try {
    const response = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({
        model: "fixture-model",
        stream: true,
        messages: [{ role: "user", content: "RL_TURN_0042" }],
      }),
    })
    const text = await response.text()
    assert.equal(response.status, 200)
    assert.ok(text.includes("RL_REPLY_0042"))
    assert.ok(text.includes("RL_END_0042"))
    assert.ok(text.endsWith("data: [DONE]\n\n"))
    assert.equal(server.calls[0].model, "fixture-model")
    assert.ok(server.calls[0].output > 6000 && server.calls[0].output < 6200)
    assert.ok(!JSON.stringify(server.calls).includes("headers"))
    const rejected = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ model: "real-provider-fallback", messages: [] }),
    })
    assert.equal(rejected.status, 400)
    assert.equal(server.calls.length, 1)
  } finally {
    await server.close()
  }
})

test("deny-proxy returns no external data and survives client disconnect", async () => {
  const server = await serve()
  try {
    const req = request(server.url, { method: "CONNECT", path: "external.invalid:443" })
    const connected = once(req, "connect")
    req.end()
    const [response, socket] = await connected
    assert.equal(response.statusCode, 403)
    socket.destroy()
    const health = await fetch(`${server.url}/v1/models`)
    assert.equal(health.status, 200)
    assert.ok(server.blocked.some((entry) => entry.target === "external.invalid"))
  } finally {
    await server.close()
  }
})

test("profile preparation uses literal environment and only a dummy loopback model", async () => {
  const server = await serve()
  const run = await prepare("selftest", server, defaults)
  try {
    for (const value of Object.values(run.dirs)) assert.ok(inside(run.root, value))
    for (const key of [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
    ])
      assert.ok(inside(run.root, run.env[key]), key)
    for (const key of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "KILO_TOKEN",
      "VSCODE_IPC_HOOK_CLI",
      "ELECTRON_RUN_AS_NODE",
      "NODE_OPTIONS",
    ])
      assert.equal(run.env[key], undefined, key)
    assert.deepEqual(run.config.enabled_providers, ["fixture"])
    assert.deepEqual(run.config.mcp, {})
    assert.equal(run.env.GIT_CEILING_DIRECTORIES, run.state)
    assert.equal(run.config.provider.fixture.options.baseURL, `${server.url}/v1`)
    assert.ok(run.args.some((arg) => arg.startsWith("--user-data-dir=")))
    assert.ok(run.args.some((arg) => arg.startsWith("--extensions-dir=")))
    assert.ok(!run.args.some((arg) => arg.startsWith("--extensionDevelopmentPath")))
  } finally {
    await server.close()
    await cleanup(run)
  }
})

test("diagnostics redact authorization, password, API key and signed URL queries", () => {
  const input =
    'Authorization: Bearer dummy-auth-value password="private-value" apiKey="private-key-value" https://example.invalid/path?token=private-query'
  const output = sanitize(input)
  for (const secret of ["dummy-auth-value", "private-value", "private-key-value", "private-query"])
    assert.ok(!output.includes(secret))
  assert.ok(output.includes("[REDACTED]"))
})
