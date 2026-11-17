#!/usr/bin/env bun
// Manual end-to-end check for the browser tools: a local fixture, a scripted OpenAI-compatible model, and the compiled
// CLI binary driven through `run`. Not a `bun test` file, because it needs a display (run it under xvfb), a built
// binary, and a browser.
//
//   bun test/browser/e2e.ts <binary> flow <full|diff|none>
//   bun test/browser/e2e.ts <binary> missing-browser
//
// `flow` navigates, snapshots, clicks the button by the ref the snapshot reported, and takes a screenshot, then
// prints one JSON report and exits non-zero when an expectation fails. `missing-browser` expects the install hint.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const binary = process.argv[2]
const operation = process.argv[3] ?? "flow"
const mode = process.argv[4] ?? "full"
if (!binary) throw new Error("usage: bun test/browser/e2e.ts <binary> flow|missing-browser [full|diff|none]")

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body>
  <h1>Browser E2E</h1>
  <button id="go">Click me</button>
  <p id="status">idle</p>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      document.getElementById("status").textContent = "clicked"
    })
  </script>
</body></html>`

const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
})

type Call = { name: string; args: unknown }
type Step = { calls: Call[]; results: string[] }

function field<K extends string>(value: unknown, key: K): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return value[key]
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .flatMap((part) => {
      const type = field(part, "type")
      const text = field(part, "text")
      return type === "text" && typeof text === "string" ? [text] : []
    })
    .join("\n")
}

function callsOf(toolCalls: unknown): Call[] {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.flatMap((call): Call[] => {
    const fn = field(call, "function")
    const name = field(fn, "name")
    if (typeof name !== "string") return []
    const raw = field(fn, "arguments")
    let args: unknown = raw
    try {
      args = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      args = raw
    }
    return [{ name, args }]
  })
}

/** One Chat Completions request reduced to the script: the assistant's tool calls, in order, and every tool result. */
function read(messages: unknown): Step {
  const calls: Call[] = []
  const results: string[] = []
  if (!Array.isArray(messages)) return { calls, results }
  for (const message of messages) {
    const role = field(message, "role")
    if (role === "assistant") calls.push(...callsOf(field(message, "tool_calls")))
    if (role === "tool") results.push(textOf(field(message, "content")))
  }
  return { calls, results }
}

function chunk(model: string, delta: object, finish: string | null) {
  return `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
}

function toolCall(model: string, name: string, args: unknown) {
  return [
    chunk(
      model,
      {
        role: "assistant",
        tool_calls: [
          { index: 0, id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      null,
    ),
    chunk(model, {}, "tool_calls"),
    `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")
}

function text(model: string, answer: string) {
  return [
    chunk(model, { role: "assistant", content: answer }, null),
    chunk(model, {}, "stop"),
    `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")
}

const record: { steps: Step[] } = { steps: [] }

/** Where the scripted model asks for the screenshot: an absolute path, so the run's own directory never matters. */
let screenshotFile = ""

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })

const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? (field(body, "model") as string) : "local"
    const declared = field(body, "tools")
    const tools = Array.isArray(declared) ? declared.flatMap((tool) => {
      const fn = field(tool, "function")
      const id = field(fn, "name")
      return typeof id === "string" ? [id] : []
    }) : []
    // A title or utility request carries no browser tools; it only needs an answer.
    if (!tools.some((tool) => tool.startsWith("browser_"))) return sse(text(name, "Browser E2E"))

    const step = read(field(body, "messages"))
    record.steps.push(step)
    const index = step.results.length
    const answer = (tool: string, args: unknown) => sse(toolCall(name, tool, args))

    if (index === 0) return answer("browser_navigate", { url: fixture.url.origin })
    if (index === 1) return answer("browser_snapshot", {})
    if (index === 2) {
      // The ref comes from the snapshot the model just received: click by ref, never by position.
      const ref = /button "Click me" \[ref=([^\]]+)\]/.exec(step.results[1] ?? "")?.[1]
      // No snapshot means no browser served the earlier calls (the tool errors carry the reason); stop there.
      if (!ref) return sse(text(name, "Browser E2E stopped: no page snapshot."))
      return answer("browser_click", { element: "the Click me button", target: ref })
    }
    if (index === 3) return answer("browser_take_screenshot", { filename: screenshotFile, type: "png" })
    return sse(text(name, "Browser E2E finished"))
  },
})

const config = (observation: string) => ({
  model: "local/echo",
  providers: {
    local: {
      name: "Local",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `${model.url.origin}/v1`, apiKey: "local-key" },
      models: { echo: { name: "Echo", limit: { context: 32000, output: 4000 } } },
    },
  },
  browser: { backend: "playwright", observation, headless: false },
})

async function home() {
  // One data dir across the runs of a suite: `missing-browser` installs Chromium, the flows use it.
  const root = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "browser-e2e-")))
  await fs.mkdir(path.join(root, "data"), { recursive: true })
  return root
}

function environment(root: string, observation: string) {
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: path.join(root, "run"),
    KILO_CONFIG_CONTENT: JSON.stringify(config(observation)),
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_AUTH_CONTENT: "",
    KILO_API_KEY: "",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  }
}

async function cli(root: string, observation: string, args: string[], timeout = 240_000) {
  const child = Bun.spawn([binary, ...args], {
    env: environment(root, observation),
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

const failures: string[] = []

function expect(condition: boolean, message: string) {
  if (!condition) failures.push(message)
}

const hasRef = (args: unknown) => typeof field(args, "ref") === "string"

async function flow(observation: string) {
  const root = await home()
  record.steps = []
  screenshotFile = path.join(root, "probe.png")
  const run = await cli(root, observation, [
    "run",
    "Open the fixture and click the button.",
    "--model",
    "local/echo",
    "--standalone",
    "--format",
    "json",
  ])
  // The last request carries the whole conversation: its results are navigate, snapshot, click, screenshot.
  const last = record.steps.at(-1) ?? { calls: [], results: [] }
  const output = path.join(root, "data", "kilo2", "browser", "output")
  const files = await fs.readdir(output).catch(() => [] as string[])
  const shot = await fs.readFile(screenshotFile).catch(() => undefined)
  const names = last.calls.map((call) => call.name)
  const click = last.calls.filter((call) => call.name === "browser_click")
  const clickResult = last.results[2] ?? ""
  const navigateResult = last.results[0] ?? ""
  const screenshotResult = last.results[3] ?? ""

  expect(run.code === 0, `run exited ${run.code}\n${run.stderr.slice(-2000)}`)
  expect(
    names.join(",") === "browser_navigate,browser_snapshot,browser_click,browser_take_screenshot",
    `unexpected tool order: ${names.join(",")}`,
  )
  expect(click.length === 1 && hasRef(click[0].args), "the click did not use a ref")
  expect(
    navigateResult.includes("- Page Title: Browser E2E"),
    `navigate result has no page title: ${navigateResult.slice(0, 200)}`,
  )
  expect(
    shot !== undefined && shot.length > 10_000 && shot.subarray(0, 4).toString("hex") === "89504e47",
    "the screenshot file is missing or not a PNG",
  )
  expect(
    screenshotResult.includes("data:image/png;base64") || screenshotResult.includes("probe.png"),
    "the screenshot result reached the model",
  )

  if (observation === "full") {
    expect(clickResult.includes("### Snapshot"), "full mode did not return the snapshot after the click")
    expect(clickResult.includes("Clicked"), `full mode has no action result: ${clickResult.slice(0, 200)}`)
  }
  if (observation === "diff") {
    expect(clickResult.includes("### Page changes"), `diff mode did not report page changes: ${clickResult.slice(0, 300)}`)
    expect(!clickResult.includes("### Snapshot"), "diff mode returned the full snapshot")
  }
  if (observation === "none") {
    expect(clickResult.includes("### Status"), `none mode did not report only the status: ${clickResult.slice(0, 300)}`)
    expect(!clickResult.includes("### Snapshot") && !clickResult.includes("### Page changes"), "none mode returned page state")
  }

  return {
    mode: observation,
    exit: run.code,
    tools: names,
    stdout: run.stdout.slice(-400),
    stderr: run.stderr.slice(-400),
    screenshot: { path: screenshotFile, directory: output, files, bytes: shot?.length ?? 0 },
    click: clickResult.slice(0, 400),
  }
}

async function missingBrowser() {
  const root = await home()
  record.steps = []
  const run = await cli(root, "full", [
    "run",
    "Open the fixture.",
    "--model",
    "local/echo",
    "--standalone",
    "--format",
    "json",
  ])
  const logDirectory = path.join(root, "data", "kilo2", "log")
  const logs = await fs.readdir(logDirectory).catch(() => [] as string[])
  const logged = (
    await Promise.all(logs.map((file) => fs.readFile(path.join(logDirectory, file), "utf8").catch(() => "")))
  ).join("\n")
  const reported = `${run.stdout}\n${run.stderr}\n${logged}`
  expect(reported.includes("kilo browser install-chromium"), `no install hint in the run output or logs:\n${reported.slice(-2500)}`)

  const installed = await cli(root, "full", ["browser", "install-chromium"], 600_000)
  expect(installed.code === 0, `install-chromium exited ${installed.code}\n${installed.stderr.slice(-2000)}`)
  const executable = installed.stdout.trim().split(/\s+/)[0]
  const exists = executable.length > 0 && (await fs.stat(executable).catch(() => undefined))?.isFile() === true
  expect(exists, `install-chromium did not produce an executable: ${installed.stdout}`)
  const second = await cli(root, "full", ["browser", "install-chromium"], 600_000)
  expect(
    second.code === 0 && second.stdout.includes("already installed"),
    `a second install is not a no-op: ${second.stdout} ${second.stderr}`,
  )
  return {
    exit: run.code,
    install: installed.stdout.trim().slice(-300),
    executable,
    reused: second.stdout.trim().slice(-200),
    hint: /no browser found[^\n]*/i.exec(reported)?.[0] ?? "install hint reported",
  }
}

const report = operation === "missing-browser" ? await missingBrowser() : await flow(mode)
fixture.stop(true)
model.stop(true)
console.log(JSON.stringify({ operation, ...report, failures }, null, 2))
if (failures.length) process.exitCode = 1
