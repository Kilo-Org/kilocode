import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { parseSandboxConfig, prepareShell, sandboxSupport, type ShellInvocation } from "../src/sandbox"
import { fixture, ready } from "./fixture"

type Completion = {
  stream?: boolean
  messages: ReadonlyArray<{ role: string; content?: unknown }>
}

function streamAnswer(content: string) {
  return streamResponse({ role: "assistant", content }, "stop")
}

function streamTool(input: { command: string; description: string }) {
  return streamResponse(
    {
      tool_calls: [
        {
          index: 0,
          id: "call_sandbox",
          type: "function",
          function: { name: "shell", arguments: JSON.stringify(input) },
        },
      ],
    },
    "tool_calls",
  )
}

function streamResponse(delta: Record<string, unknown>, finishReason: string) {
  const frames = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ]
  return new Response(
    frames
      .map(
        (frame) =>
          `data: ${JSON.stringify({
            id: "sandbox-fixture",
            object: "chat.completion.chunk",
            model: "chat",
            created: 1,
            ...frame,
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

const support = sandboxSupport()

test("sandbox configuration is opt-in and validates unknown values", () => {
  expect(parseSandboxConfig(undefined)).toEqual({ enabled: false })
  expect(parseSandboxConfig(false)).toEqual({ enabled: false })
  expect(parseSandboxConfig({ network: "deny" })).toMatchObject({ enabled: false, network: "deny" })
  expect(() => parseSandboxConfig({ enabled: "yes" })).toThrow("sandbox.enabled must be a boolean")
  expect(() => parseSandboxConfig({ enabled: true, network: "proxy" })).toThrow(
    "sandbox.network must be `allow` or `deny`",
  )
  expect(() => parseSandboxConfig({ enabled: true, unknown: true })).toThrow("Unknown sandbox option: unknown")
})

test("enabled sandbox configuration fails closed for invalid filesystem roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-config-"))
  try {
    const invocation = invocationFor(root)
    await expect(prepareShell(invocation, { enabled: true, root: path.join(root, "does-not-exist") })).rejects.toThrow(
      "sandbox.root does not exist",
    )
    await expect(prepareShell(invocation, { enabled: true, root: path.parse(root).root })).rejects.toThrow(
      "sandbox.root cannot be the filesystem root",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("missing Linux sandbox binary is reported as unavailable", () => {
  const missing = path.join(os.tmpdir(), `kilo2-no-bwrap-${crypto.randomUUID()}`)
  expect(sandboxSupport({ platform: "linux", bwrapPath: missing })).toMatchObject({
    available: false,
    backend: "linux",
  })
})

test.skipIf(!support.available)("native sandbox allows workspace writes and denies outside writes", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-test-"))
  const root = path.join(parent, "workspace")
  const outside = path.join(parent, "outside")
  await mkdir(root, { recursive: true })
  await mkdir(outside, { recursive: true })
  try {
    const inside = path.join(root, "inside.txt")
    const escaped = path.join(outside, "escaped.txt")
    const result = await run(invocationFor(root, `printf inside > ${quote(inside)}`), { enabled: true, root })
    expect(result.code).toBe(0)
    expect(await readFile(inside, "utf8")).toBe("inside")

    const denied = await run(invocationFor(root, `printf outside > ${quote(escaped)}`), { enabled: true, root })
    expect(denied.code).not.toBe(0)
    await expect(readFile(escaped, "utf8")).rejects.toThrow()
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test.skipIf(!support.available)("native sandbox keeps explicitly denied paths read-only", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-deny-"))
  const root = path.join(parent, "workspace")
  const policy = path.join(root, "policy")
  await mkdir(policy, { recursive: true })
  try {
    const allowed = path.join(root, "allowed.txt")
    const blocked = path.join(policy, "blocked.txt")
    const result = await run(invocationFor(root, `printf allowed > ${quote(allowed)}`), {
      enabled: true,
      root,
      denyWritePaths: [policy],
    })
    expect(result.code).toBe(0)
    expect(await readFile(allowed, "utf8")).toBe("allowed")

    const denied = await run(invocationFor(root, `printf blocked > ${quote(blocked)}`), {
      enabled: true,
      root,
      denyWritePaths: [policy],
    })
    expect(denied.code).not.toBe(0)
    await expect(readFile(blocked, "utf8")).rejects.toThrow()
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test.skipIf(!support.available)("native sandbox denies default protected names", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-name-"))
  const root = path.join(parent, "workspace")
  const git = path.join(root, ".git")
  await mkdir(git, { recursive: true })
  try {
    const blocked = path.join(git, "blocked.txt")
    const result = await run(invocationFor(root, `printf blocked > ${quote(blocked)}`), { enabled: true, root })
    expect(result.code).not.toBe(0)
    await expect(readFile(blocked, "utf8")).rejects.toThrow()
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

function invocationFor(cwd: string, command = "true"): ShellInvocation {
  return {
    command,
    cwd,
    shell: process.platform === "darwin" ? "/bin/zsh" : "/bin/sh",
    env: { PATH: process.env.PATH },
  }
}

test.skipIf(!support.available)("interactive host confines a model shell through the SDK post plugin", async () => {
  const curl = Bun.which("curl")
  if (!curl) return
  await using input = await fixture()
  const outside = path.join(input.directory, "outside")
  await mkdir(outside, { recursive: true })
  const insideFile = path.join(input.cwd, "model-inside.txt")
  const outsideFile = path.join(outside, "model-outside.txt")
  let networkHits = 0
  const requests: Completion[] = []
  let transcript = ""
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      networkHits++
      return new Response("unexpected")
    },
  })
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      requests.push(body)
      if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
      if (body.messages.at(-1)?.role === "tool") return streamAnswer("Sandbox command completed")
      return streamTool({
        command: [
          `printf allowed > ${quote(insideFile)}`,
          `printf outside > ${quote(outsideFile)}`,
          `${quote(curl)} --silent --show-error --max-time 1 http://127.0.0.1:${listener.port} >/dev/null`,
        ].join("; "),
        description: "Write the isolated sandbox fixture",
      })
    },
  })
  const config = JSON.stringify({
    model: "fixture/chat",
    permissions: [
      { action: "external_directory", resource: path.join(outside, "*"), effect: "allow" },
      { action: "shell", resource: "*", effect: "allow" },
    ],
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
  })
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "../src/sandbox/interactive-fixture.ts")],
    {
      cwd: input.cwd,
      env: { ...input.env, KILO_SANDBOX_ROOT: input.cwd, KILO_SANDBOX_FIXTURE_CONFIG: config },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    },
  )
  const errors = new Response(child.stderr).text()
  let childStopped = false
  const stopChild = async () => {
    if (childStopped) return
    child.kill("SIGTERM")
    await child.exited
    childStopped = true
  }
  try {
    const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME!, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = OpenCode.make({
      baseUrl: endpoint.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    const location = { directory: input.cwd }
    await client.plugin.awaitActivation({ location })
    const plugins = (await client.plugin.list({ location })).data
    expect(plugins.find((plugin) => plugin.id === "kilo2.sandbox")).toMatchObject({
      source: { type: "sdk" },
      state: { status: "active" },
    })
    const session = await client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    await client.session.prompt({ sessionID: session.id, text: "Run the sandbox fixture shell command" })
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15000) })
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.some((request) => request.messages.at(-1)?.role === "tool")).toBe(true)
    transcript = JSON.stringify(await client.message.list({ sessionID: session.id }))
    expect(await readFile(insideFile, "utf8")).toBe("allowed")
    await expect(readFile(outsideFile, "utf8")).rejects.toThrow()
    expect(networkHits).toBe(0)
  } catch (error) {
    await stopChild()
    const stderr = await errors
    throw new Error(`${String(error)}\nmodel requests: ${requests.length}\ntranscript: ${transcript}\n${stderr}`, {
      cause: error,
    })
  } finally {
    await stopChild()
    await model.stop(true)
    await listener.stop(true)
    await errors
    expect((await readdir(input.env.TMPDIR!)).filter((entry) => entry.startsWith("kilo2-sandbox-"))).toEqual([])
  }
})

async function run(invocation: ShellInvocation, config: Parameters<typeof prepareShell>[1]) {
  const prepared = await prepareShell(invocation, config)
  const child = Bun.spawn([prepared.shell, "-c", prepared.command], {
    cwd: prepared.cwd,
    env: Object.fromEntries(
      Object.entries(prepared.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function quote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
