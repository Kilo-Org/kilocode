import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { help, parseCommand } from "../src/commands"
import { parseTuiArgs } from "../src/tui"
import { fixture, ready, type Fixture } from "./fixture"

test("cloud streaming is an explicit start-only option with a local request file", () => {
  expect(parseCommand(["cloud", "start", "request.json"])).toEqual({
    type: "cloud",
    action: "start",
    file: path.resolve("request.json"),
  })
  for (const args of [
    ["request.json", "--stream"],
    ["--stream", "request.json"],
  ]) {
    expect(parseCommand(["cloud", "start", ...args])).toEqual({
      type: "cloud",
      action: "start",
      file: path.resolve("request.json"),
      stream: true,
    })
  }
  for (const args of [
    ["start", "--stream"],
    ["start", "https://example.test/request.json"],
    ["start", "request.json", "extra"],
    ["send", "session", "hello", "--stream"],
    ["status", "session", "message", "--stream"],
  ])
    expect(() => parseCommand(["cloud", ...args])).toThrow()
})

test("indexing requires an explicit local configuration on each execution host", () => {
  for (const args of [["run", "hello"], ["serve"], ["acp"]]) {
    expect(parseCommand([...args, "--indexing-config", "index.jsonc"])).toMatchObject({
      indexingConfig: path.resolve("index.jsonc"),
    })
    expect(parseCommand(args)).not.toHaveProperty("indexingConfig", expect.any(String))
    for (const file of ["", "https://example.test/index.jsonc"])
      expect(() => parseCommand([...args, "--indexing-config", file])).toThrow("local configuration file")
  }
  expect(parseTuiArgs(["--indexing-config", "index.jsonc", "--project-config", "./project"])).toEqual({
    indexingConfig: path.resolve("index.jsonc"),
    projectConfig: true,
    directory: "./project",
  })
  expect(() => parseTuiArgs(["--indexing-config"])).toThrow("local configuration file")
  expect(() => parseTuiArgs(["--indexing-config", "https://example.test/index.jsonc"])).toThrow(
    "local configuration file",
  )
  expect(() => parseCommand(["attach", "--indexing-config", "index.jsonc"])).toThrow()
  expect(() => parseCommand(["service", "start", "--indexing-config", "index.jsonc"])).toThrow()
})

test("swarm is an explicit execution-host opt-in, never a daemon policy mutation", () => {
  for (const args of [["run", "hello"], ["serve"], ["acp"]]) {
    expect(parseCommand([...args, "--swarm"])).toMatchObject({ swarm: true })
    expect(parseCommand(args)).not.toHaveProperty("swarm", true)
  }
  expect(parseTuiArgs(["--swarm", "--project-config", "./project"])).toEqual({
    swarm: true,
    projectConfig: true,
    directory: "./project",
  })
  expect(() => parseCommand(["attach", "--swarm"])).toThrow()
  expect(() => parseCommand(["service", "start", "--swarm"])).toThrow()
})

test("invalid indexing configuration fails before opening the isolated store", async () => {
  await using input = await fixture()
  const file = path.join(input.directory, "index.jsonc")
  await Bun.write(file, JSON.stringify({ apiKey: "sk-invalid-indexing-secret", enabled: "yes" }))
  const result = await invoke(input, ["run", "hello", "--directory", input.cwd, "--indexing-config", file])
  expect(result.code).toBe(1)
  expect(result.stdout).toBe("")
  expect(result.stderr).toContain("does not match the indexing schema")
  expect(result.stderr).not.toContain("sk-invalid-indexing-secret")
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
})

test("headless transfer command arguments are explicit and bounded", () => {
  expect(parseCommand(["export", "ses_test", "--sanitize"])).toEqual({
    type: "export",
    sessionID: "ses_test",
    sanitize: true,
  })
  expect(parseCommand(["sessions", "--directory", "."])).toEqual({
    type: "sessions",
    directory: process.cwd(),
  })
  expect(parseCommand(["models", "--directory", "."])).toEqual({ type: "models", directory: process.cwd() })
  expect(parseCommand(["agents", "--directory", "."])).toEqual({ type: "agents", directory: process.cwd() })
  expect(() => parseCommand(["models", "extra"])).toThrow()
  expect(parseCommand(["import", "transcript.json", "--directory", "target"])).toEqual({
    type: "import",
    file: path.resolve("transcript.json"),
    directory: path.resolve("target"),
  })
  expect(
    parseCommand(["import-external", "claude.jsonl", "--model", "anthropic/claude-sonnet", "--agent", "build"]),
  ).toEqual({
    type: "import-external",
    file: path.resolve("claude.jsonl"),
    directory: process.cwd(),
    model: { providerID: "anthropic", id: "claude-sonnet" },
    agent: "build",
  })
  expect(
    parseCommand([
      "import-external",
      "codex.jsonl",
      "--model",
      "openai/gpt-5",
      "--agent",
      "build",
      "--directory",
      "target",
    ]),
  ).toMatchObject({ type: "import-external", directory: path.resolve("target") })
  expect(() => parseCommand(["import-external", "claude.jsonl", "--agent", "build"])).toThrow("--model")
  expect(() => parseCommand(["import-external", "claude.jsonl", "--model", "anthropic/model"])).toThrow("--agent")
  expect(() =>
    parseCommand(["import-external", "https://example.com/transcript.jsonl", "--model", "a/b", "--agent", "build"]),
  ).toThrow("local")
  expect(() => parseCommand(["import-external", "claude.jsonl", "--model", "anthropic/", "--agent", "build"])).toThrow(
    "provider/model",
  )
  expect(parseCommand(["./project"])).toBeUndefined()
  expect(parseCommand(["import-v1", "--auth", "auth.json"])).toEqual({
    type: "import-v1",
    auth: path.resolve("auth.json"),
    config: undefined,
    apply: false,
  })
  expect(() => parseCommand(["import-v1"])).toThrow("Usage:")
  expect(() => parseCommand(["import-v1", "--auth", "https://example.com/auth.json"])).toThrow("local file")
  expect(parseCommand(["serve"])).toEqual({ type: "serve" })
  expect(parseCommand(["serve", "--sandbox"])).toEqual({ type: "serve", sandbox: true })
  expect(parseCommand(["run", "--sandbox", "hello"])).toMatchObject({ type: "run", sandbox: true })
  expect(parseCommand(["service", "start"])).toEqual({ type: "service", action: "start" })
  expect(parseCommand(["service", "status"])).toEqual({ type: "service", action: "status" })
  expect(parseCommand(["service", "stop"])).toEqual({ type: "service", action: "stop" })
  expect(() => parseCommand(["service", "restart"])).toThrow("Usage:")
  expect(() => parseCommand(["service", "stop", "extra"])).toThrow("Usage:")
  expect(parseCommand(["attach", "--directory", ".", "-s", "ses_test"])).toEqual({
    type: "attach",
    directory: process.cwd(),
    sessionID: "ses_test",
  })
  expect(() => parseCommand(["attach", "--session", ""])).toThrow("Session ID")
  expect(() => parseCommand(["serve", "--port", "9999"])).toThrow("Unknown option")
  expect(() => parseCommand(["export"])).toThrow("Usage:")
  expect(() => parseCommand(["export", "ses_test", "extra"])).toThrow("Usage:")
  expect(() => parseCommand(["sessions", "extra"])).toThrow()
  expect(() => parseCommand(["import", "https://example.com/share"])).toThrow("local v2 JSON files")
  expect(() =>
    parseCommand(["import-external", "claude.jsonl", "--model", "a/b", "--agent", "build", "extra"]),
  ).toThrow("Usage:")
  expect(() => parseCommand(["export", "ses_test", "--unknown"])).toThrow()
  expect(parseCommand(["run", "hello", "world", "--auto", "-m", "fixture/vendor/model", "-s", "ses_test"])).toEqual({
    type: "run",
    text: "hello world",
    directory: process.cwd(),
    sessionID: "ses_test",
    model: { providerID: "fixture", id: "vendor/model" },
    agent: undefined,
    auto: true,
    files: [],
    format: "text",
  })
  expect(parseCommand(["run"])).toMatchObject({ type: "run", text: "" })
  expect(
    parseCommand(["run", "--format", "json", "-f", "one.ts", "--file", "two.png", "--directory", "target"]),
  ).toMatchObject({ files: [path.resolve("one.ts"), path.resolve("two.png")], format: "json" })
  expect(() => parseCommand(["run", "--format", "xml"])).toThrow("format")
  expect(() => parseCommand(["run", "-f", "https://example.com/image.png"])).toThrow("local file")
  expect(() => parseCommand(["run", "hello", "--model", "fixture/"])).toThrow("provider/model")
  expect(() => parseCommand(["run", "hello", "--model", "fixture"])).toThrow("provider/model")
  expect(() => parseCommand(["run", "hello", "--session", ""])).toThrow("Session ID")
  expect(() => parseCommand(["run", "hello", "--agent", ""])).toThrow("Agent name")
  expect(help).toContain("does not migrate V1")
  expect(help).toContain("Import-external creates a fresh session")
})

test("v1 import previews without a store and explicitly applies supported config without changing sources", async () => {
  await using input = await fixture()
  const source = path.join(input.directory, "v1.jsonc")
  const text = '{ // retained only in source\n "model": "fixture/chat", }'
  await Bun.write(source, text)
  const auth = path.join(input.directory, "auth.json")
  await Bun.write(auth, JSON.stringify({ fixture: { type: "api", key: "secret-cli-import-key" } }))
  const preview = await invoke(input, ["import-v1", "--config", source, "--auth", auth])
  expect(preview.code, preview.stderr).toBe(0)
  expect(JSON.parse(preview.stdout).status).toBe("preview")
  expect(preview.stdout).not.toContain("secret-cli-import-key")
  expect(preview.stdout).not.toContain("fixture/chat")
  const target = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/kilo.jsonc")
  expect(await Bun.file(target).exists()).toBe(false)
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
  const applied = await invoke(input, ["import-v1", "--config", source, "--apply"])
  expect(applied.code, applied.stderr).toBe(0)
  expect(JSON.parse(applied.stdout).status).toBe("applied")
  expect(JSON.parse(await Bun.file(target).text()).model).toEqual({ providerID: "fixture", model: "chat" })
  expect(await Bun.file(source).text()).toBe(text)
  const before = await Bun.file(target).text()
  await Bun.write(source, '{ "model": "fixture/other" }')
  const conflict = await invoke(input, ["import-v1", "--config", source, "--apply"])
  expect(conflict.code).toBe(1)
  expect(JSON.parse(conflict.stdout).status).toBe("refused")
  expect(await Bun.file(target).text()).toBe(before)
})

test("CLI Kilo OAuth import requires explicit authority and preserves selection without reporting secrets", async () => {
  await using input = await fixture()
  const organizationID = "123e4567-e89b-12d3-a456-426614174000"
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/profile")
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: [{ id: organizationID, name: "Fixture team", role: "owner" }],
          hasPersonalAccount: true,
        })
      return new Response(null, { status: 404 })
    },
  })
  try {
    const source = path.join(input.directory, "v1-auth.json")
    const token = "fixture-cli-oauth-secret"
    const contents = JSON.stringify({
      kilo: { type: "oauth", refresh: token, access: token, expires: 0, accountId: organizationID },
    })
    await Bun.write(source, contents)
    const target = { ...input, env: { ...input.env, KILO_API_URL: backend.url.origin } }
    const missing = await invoke(target, ["import-v1", "--auth", source])
    expect(missing.code, missing.stderr).toBe(0)
    expect(JSON.parse(missing.stdout).credentials[0].supported).toBe(false)
    expect(missing.stdout).not.toContain(token)
    const database = path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")
    expect(await Bun.file(database).exists()).toBe(false)
    const applied = await invoke(target, [
      "import-v1",
      "--auth",
      source,
      "--gateway-server",
      backend.url.origin,
      "--apply",
    ])
    expect(applied.code, applied.stderr).toBe(0)
    expect(JSON.parse(applied.stdout).status).toBe("applied")
    expect(applied.stdout + applied.stderr).not.toContain(token)
    expect(applied.stdout).not.toContain(backend.url.origin)
    expect(await Bun.file(source).text()).toBe(contents)
    // Inspect only this synthetic fixture's store; no credential-read RPC is added.
    using db = new Database(database, { readonly: true })
    const row = db.query<{ value: string }, []>("SELECT value FROM credential WHERE integration_id = 'kilo'").get()
    expect(JSON.parse(row!.value)).toMatchObject({
      type: "oauth",
      methodID: "device",
      access: token,
      refresh: token,
      expires: 0,
      metadata: { server: backend.url.origin, organizationID },
    })
  } finally {
    await backend.stop(true)
  }
})

test("managed lifecycle CLI prints safe metadata and attach requires a running daemon", async () => {
  await using input = await fixture()
  const stopped = await invoke(input, ["service", "status"])
  expect(stopped.code, stopped.stderr).toBe(0)
  expect(JSON.parse(stopped.stdout).state).toBe("stopped")
  const attach = await invoke(input, ["attach", "--directory", input.cwd])
  expect(attach.code).toBe(1)
  expect(attach.stderr).toContain("service start")
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
  try {
    const started = await invoke(input, ["service", "start"])
    expect(started.code, started.stderr).toBe(0)
    const state = JSON.parse(started.stdout)
    expect(state.state).toBe("running")
    expect(state.url).toStartWith("http://127.0.0.1:")
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    expect(started.stdout).not.toContain(password)
    expect(state).not.toHaveProperty("endpoint")
    const current = await invoke(input, ["service", "status"])
    expect(current.code, current.stderr).toBe(0)
    expect(JSON.parse(current.stdout).pid).toBe(state.pid)
    expect(current.stdout).not.toContain(password)
    const again = await invoke(input, ["service", "start"])
    expect(again.code, again.stderr).toBe(0)
    expect(JSON.parse(again.stdout).pid).toBe(state.pid)
  } finally {
    const stopped = await invoke(input, ["service", "stop"])
    expect(stopped.code, stopped.stderr).toBe(0)
  }
  expect(JSON.parse((await invoke(input, ["service", "status"])).stdout).state).toBe("stopped")
})

test("foreground conversation server exposes authenticated v2 API and shuts down cleanly", async () => {
  await using input = await fixture()
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      "@opentui/solid/preload",
      path.resolve(import.meta.dir, "../src/tui-preview.ts"),
      "serve",
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: input.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    },
  )
  const errors = new Response(child.stderr).text()
  try {
    const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    expect((await fetch(`${endpoint.value}/api/session/active`)).status).toBe(401)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = OpenCode.make({
      baseUrl: endpoint.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    expect(await client.session.active()).toEqual({})
    const session = await client.session.create({ location: { directory: input.cwd }, title: "Foreground API fixture" })
    expect((await client.session.get({ sessionID: session.id })).title).toBe("Foreground API fixture")
    child.kill("SIGTERM")
    expect(await child.exited, await errors).toBe(0)
  } finally {
    child.kill("SIGTERM")
    await child.exited
  }
})

test("conversation entrypoint supports help and machine-readable sessions without a terminal", async () => {
  await using input = await fixture()
  const run = (args: string[]) => invoke(input, args)
  const usage = await run(["--help"])
  expect(usage.code, usage.stderr).toBe(0)
  expect(usage.stdout).toContain("kilo2 export")
  const version = await run(["--version"])
  expect(version.code, version.stderr).toBe(0)
  expect(version.stdout).toContain("Kilo internal preview 0.0.0-internal")
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
  const sessions = await run(["sessions", "--directory", input.cwd])
  expect(sessions.code, sessions.stderr).toBe(0)
  expect(JSON.parse(sessions.stdout).data).toEqual([])
  const file = path.join(input.directory, "portable.json")
  await Bun.write(
    file,
    JSON.stringify({
      info: {
        id: "ses_source",
        projectID: "source",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2, idle: 2 },
        title: "Portable transcript fixture",
        location: { directory: input.cwd },
      },
      messages: [{ id: "msg_source", type: "user", text: "Private fixture text", time: { created: 1 } }],
    }),
  )
  const imported = await run(["import", file, "--directory", input.cwd])
  expect(imported.code, imported.stderr).toBe(0)
  const copy = JSON.parse(imported.stdout)
  expect(copy.id).not.toBe("ses_source")
  const exported = await run(["export", copy.id])
  expect(exported.code, exported.stderr).toBe(0)
  expect(JSON.parse(exported.stdout).messages[0].text).toBe("Private fixture text")
  const sanitized = await run(["export", copy.id, "--sanitize"])
  expect(sanitized.code, sanitized.stderr).toBe(0)
  expect(sanitized.stdout).not.toContain("Private fixture text")
  expect(JSON.parse(sanitized.stdout).info.location.directory).toStartWith("/[redacted:")
  // Upstream's sanitizer does not redact every path-bearing field, including info.subpath.
  expect(help).toContain("can retain paths/identifiers")
  const duplicate = await run(["import", file, "--directory", input.cwd])
  expect(duplicate.code, duplicate.stderr).toBe(0)
  expect(JSON.parse(duplicate.stdout).id).not.toBe(copy.id)
  const missing = await run(["export", "ses_missing"])
  expect(missing.code).toBe(1)
  expect(missing.stdout).toBe("")
  await Bun.write(file, '{"messages":[]}')
  const invalid = await run(["import", file, "--directory", input.cwd])
  expect(invalid.code).toBe(1)
  expect(invalid.stdout).toBe("")
})

test("import-external creates a fresh session and round-trips through CLI export", async () => {
  await using input = await fixture()
  const file = path.join(input.directory, "claude.jsonl")
  await Bun.write(
    file,
    [
      {
        type: "user",
        version: "2.42.0",
        message: { role: "user", content: [{ type: "text", text: "hello from Claude" }] },
      },
      {
        type: "assistant",
        version: "2.42.0",
        message: {
          role: "assistant",
          model: "claude-sonnet-fixture",
          content: [
            { type: "thinking", thinking: "reason", signature: "source-signature" },
            { type: "text", text: "hi" },
          ],
        },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  )
  const imported = await invoke(input, [
    "import-external",
    file,
    "--model",
    "fixture/chat",
    "--agent",
    "build",
    "--directory",
    input.cwd,
  ])
  expect(imported.code, imported.stderr).toBe(0)
  expect(imported.stderr).toBe("")
  const info = JSON.parse(imported.stdout)
  expect(Object.keys(info)).toEqual(["sessionID"])
  expect(info.sessionID).toStartWith("ses_")

  const exported = await invoke(input, ["export", info.sessionID])
  expect(exported.code, exported.stderr).toBe(0)
  const transcript = JSON.parse(exported.stdout)
  expect(transcript.info.id).toBe(info.sessionID)
  expect(transcript.info.metadata.externalResume).toMatchObject({
    format: "claude",
    sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
  })
  expect(transcript.messages.map((message: { type: string }) => message.type)).toEqual(["user", "assistant"])
  expect(transcript.messages[1].model).toEqual({ providerID: "anthropic", id: "claude-sonnet-fixture" })
  expect(transcript.messages[1].metadata).toEqual({
    externalResume: { reasoningSignatures: ["source-signature"] },
  })
  expect(transcript.messages[1].content[0]).toEqual({ type: "reasoning", text: "reason" })
  expect(transcript.messages[1].content[1]).toEqual({ type: "text", text: "hi" })

  await Bun.write(
    file,
    '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"custom"}]}}',
  )
  const refused = await invoke(input, [
    "import-external",
    file,
    "--model",
    "fixture/chat",
    "--agent",
    "build",
    "--directory",
    input.cwd,
  ])
  expect(refused.code).toBe(1)
  expect(refused.stdout).toBe("")
  expect(refused.stderr).toContain("unsupported Claude assistant content block")
})

test("run command prints final text and resumes across CLI process restarts", async () => {
  await using input = await fixture()
  const started = Promise.withResolvers<void>()
  const mode = { hold: false }
  const requests: string[] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: { stream?: boolean } = await request.json()
      if (body.stream) requests.push(JSON.stringify(body))
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "CLI fixture" } }] })
      if (mode.hold)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "chat", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "Partial" }, finish_reason: null }] })}\n\n`,
                ),
              )
              started.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      return new Response(
        [
          { choices: [{ index: 0, delta: { role: "assistant", content: "CLI response" }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  try {
    const config = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/kilo.jsonc")
    await mkdir(path.dirname(config), { recursive: true })
    await Bun.write(
      config,
      JSON.stringify({
        model: "fixture/chat",
        agents: {
          fixture: {
            description: "Fixture helper",
            mode: "primary",
            system: "private-agent-system",
            request: { headers: { "x-fixture-secret": "private-agent-header" } },
          },
          hidden_fixture: { hidden: true, description: "Do not list" },
        },
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    )
    const models = await invoke(input, ["models", "--directory", input.cwd])
    expect(models.code, models.stderr).toBe(0)
    expect(JSON.parse(models.stdout)).toContainEqual({ providerID: "fixture", id: "chat", name: "chat" })
    expect(models.stdout).not.toContain("apiKey")
    expect(models.stdout).not.toContain("baseURL")
    const agents = await invoke(input, ["agents", "--directory", input.cwd])
    expect(agents.code, agents.stderr).toBe(0)
    expect(JSON.parse(agents.stdout)).toContainEqual({
      id: "fixture",
      name: "fixture",
      description: "Fixture helper",
      mode: "primary",
    })
    expect(agents.stdout).not.toContain("private-agent")
    expect(agents.stdout).not.toContain("hidden_fixture")
    const first = await invoke(input, ["run", "Hello", "--directory", input.cwd])
    expect(first.code, first.stderr).toBe(0)
    expect(first.stdout).toBe("CLI response\n")
    const id = first.stderr.match(/Session: (ses_\S+)/)?.[1]
    expect(id).toBeDefined()
    const second = await invoke(input, ["run", "Again", "--directory", input.cwd, "--session", id!])
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toBe("CLI response\n")
    expect(second.stderr).toContain(`Session: ${id}`)
    const attachment = path.join(input.cwd, "context.ts")
    await Bun.write(attachment, 'export const fixture = "attached local source"\n')
    const piped = await invoke(
      input,
      ["run", "Use this context", "--directory", input.cwd, "-f", attachment, "--format", "json"],
      "Piped instruction",
    )
    expect(piped.code, piped.stderr).toBe(0)
    const result = JSON.parse(piped.stdout)
    expect(result.text).toBe("CLI response")
    expect(result.sessionID).toStartWith("ses_")
    expect(requests.at(-1)).toContain("Piped instruction")
    expect(requests.at(-1)).toContain("attached local source")
    const transcript = await invoke(input, ["export", result.sessionID])
    expect(transcript.code, transcript.stderr).toBe(0)
    const user = JSON.parse(transcript.stdout).messages.find((message: { type: string }) => message.type === "user")
    expect(user.text).toBe("Use this context\nPiped instruction")
    expect(user.files[0]).toMatchObject({ name: "context.ts", mime: "text/plain" })
    const stdinOnly = await invoke(
      input,
      ["run", "--directory", input.cwd, "--format", "json", "--agent", "fixture"],
      "Only piped input",
    )
    expect(stdinOnly.code, stdinOnly.stderr).toBe(0)
    expect(JSON.parse(stdinOnly.stdout).text).toBe("CLI response")
    expect(requests.at(-1)).toContain("Only piped input")
    expect(requests.at(-1)).toContain("private-agent-system")
    const failed = await invoke(input, ["run", "Hello", "--directory", input.cwd, "--model", "missing/model"])
    expect(failed.code).toBe(1)
    expect(failed.stdout).toBe("")
    mode.hold = true
    const interrupted = spawnCommand(input, ["run", "Wait for cancellation", "--directory", input.cwd])
    const stdout = new Response(interrupted.stdout).text()
    const stderr = new Response(interrupted.stderr).text()
    try {
      await started.promise
      interrupted.kill("SIGINT")
      expect(await interrupted.exited, await stderr).toBe(130)
      expect(await stdout).toBe("")
    } finally {
      interrupted.kill("SIGTERM")
      await interrupted.exited
    }
    const sessions = await invoke(input, ["sessions", "--directory", input.cwd])
    expect(sessions.code, sessions.stderr).toBe(0)
    expect(sessions.stdout).toContain('"outcome": "interrupted"')
  } finally {
    await model.stop(true)
  }
})

test("invalid run input fails before opening the isolated session store", async () => {
  await using input = await fixture()
  const empty = await invoke(input, ["run", "--directory", input.cwd, "--format", "json"], " \n")
  expect(empty.code).toBe(1)
  expect(empty.stdout).toBe("")
  expect(empty.stderr).toContain("provide a message")
  const missing = await invoke(input, [
    "run",
    "Read",
    "--directory",
    input.cwd,
    "-f",
    path.join(input.cwd, "missing.txt"),
  ])
  expect(missing.code).toBe(1)
  expect(missing.stdout).toBe("")
  expect(await Bun.file(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db")).exists()).toBe(false)
})

async function invoke(input: Fixture, args: string[], stdin?: string) {
  const child = spawnCommand(input, args, stdin)
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function spawnCommand(input: Fixture, args: string[], stdin?: string) {
  return Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      "@opentui/solid/preload",
      path.resolve(import.meta.dir, "../src/tui-preview.ts"),
      ...args,
    ],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: input.env,
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    },
  )
}
