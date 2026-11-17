#!/usr/bin/env bun
// Manual end-to-end check for the browser permissions: two local fixtures (a page with a cross-origin iframe), a
// scripted OpenAI-compatible model, and the compiled CLI driven through `run`. Not a `bun test` file: it needs a
// display (run it under xvfb), a built binary and an installed browser.
//
//   bun test/browser/permissions-e2e.ts <binary> frames|frames-allowed|ask-public|sensitive-auto|sensitive-rejected|sensitive-allowed|deny-click|navigate-file|nested
//
// Each scenario prints one JSON report and exits non-zero when an expectation fails.
import * as Png from "@kilocode/kilo-plugin/browser/png"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const binary = process.argv[2]
const scenario = process.argv[3] ?? "frames"
if (!binary) throw new Error("usage: bun test/browser/permissions-e2e.ts <binary> <scenario>")

const MARKER = "IFRAME-MARKER"

// The cross-origin frame: a red page with a marker, so the screenshot can be checked in pixels.
const frame = Bun.serve({
  hostname: "127.0.0.2",
  port: 0,
  fetch: () =>
    new Response(
      `<!doctype html><html><head><title>Frame</title></head>
<body style="margin:0;background:#ff0000"><h1 id="marker">${MARKER}</h1></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ),
})

const simple = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body>
  <h1>Browser E2E</h1>
  <button id="go">Click me</button>
  <input id="pw" type="password" aria-label="Password" />
  <p id="status">idle</p>
  <script>
    document.getElementById("go").addEventListener("click", () => {
      document.getElementById("status").textContent = "clicked"
    })
  </script>
</body></html>`

const framed = `<!doctype html>
<html><head><meta charset="utf-8"><title>Browser E2E</title></head>
<body style="margin:0">
  <iframe src="${frame.url.origin}/" style="position:fixed;left:0;top:0;width:320px;height:200px;border:0"></iframe>
  <h1 style="position:fixed;left:400px;top:0">Browser E2E</h1>
</body></html>`

let page = simple
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }),
})

// A third and fourth origin: the middle frame is withheld, and the inner frame nested in it shares its origin with a
// page the session granted `read` to earlier.
const innerPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Inner</title></head>
<body>
  <h2>Inner</h2>
  <p>INNER-MARKER</p>
  <script>console.log("INNER-CONSOLE-MARKER")</script>
</body></html>`

const inner = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(innerPage, { headers: { "content-type": "text/html; charset=utf-8" } }),
})

const middlePage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Middle</title></head>
<body style="margin:0">
  <iframe src="${inner.url.origin}/" style="width:240px;height:120px;border:0"></iframe>
  <script>console.log("MIDDLE-CONSOLE-MARKER")</script>
</body></html>`

const middle = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(middlePage, { headers: { "content-type": "text/html; charset=utf-8" } }),
})

const nestedPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>Nested E2E</title></head>
<body style="margin:0">
  <h1>Nested E2E</h1>
  <iframe src="${middle.url.origin}/" style="width:320px;height:200px;border:0"></iframe>
  <script>console.log("PAGE-CONSOLE-MARKER")</script>
</body></html>`

type Step = { calls: { name: string; args: unknown }[]; results: string[] }

function field<K extends string>(value: unknown, key: K): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined
  return (value as Record<string, unknown>)[key]
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

function callsOf(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) return []
  return toolCalls.flatMap((call) => {
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

function read(messages: unknown): Step {
  const calls: { name: string; args: unknown }[] = []
  const results: string[] = []
  if (!Array.isArray(messages)) return { calls, results }
  for (const message of messages) {
    const role = field(message, "role")
    if (role === "assistant") calls.push(...callsOf(field(message, "tool_calls")))
    if (role === "tool") results.push(textOf(field(message, "content")))
  }
  return { calls, results }
}

const chunk = (model: string, delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

const toolCall = (model: string, name: string, args: unknown) =>
  [
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

const text = (model: string, answer: string) =>
  [
    chunk(model, { role: "assistant", content: answer }, null),
    chunk(model, {}, "stop"),
    `data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("")

/** What the scripted model does at each step, given the results it has already seen. */
type Plan = (index: number, results: string[]) => { name: string; args: unknown } | undefined

/** Asking for a withheld frame needs a call that targets its ref; the grant then applies to later snapshots. */
const grantedFlow = scenario === "frames-allowed"

const plans: Record<string, Plan> = {
  // Snapshot, then (when the frame is granted) a snapshot of the frame itself, then a screenshot.
  frames: (index, results) => {
    if (index === 0) return { name: "browser_navigate", args: { url: fixture.url.origin } }
    if (index === 1) return { name: "browser_snapshot", args: {} }
    if (index === 2 && grantedFlow) {
      const ref = /iframe \[ref=([^\]]+)\]/.exec(results[1] ?? "")?.[1]
      return ref ? { name: "browser_snapshot", args: { target: ref } } : undefined
    }
    if (index === 3 && grantedFlow) return { name: "browser_snapshot", args: {} }
    if (index === (grantedFlow ? 4 : 2)) return { name: "browser_take_screenshot", args: { type: "png", scale: "css" } }
    return undefined
  },
  // Open the frame's own origin as a page: it is not the localhost family, so navigating there asks.
  "ask-public": (index) => {
    if (index === 0) return { name: "browser_navigate", args: { url: `${frame.url.origin}/` } }
    return undefined
  },
  sensitive: (index, results) => {
    if (index === 0) return { name: "browser_navigate", args: { url: fixture.url.origin } }
    if (index === 1) return { name: "browser_snapshot", args: {} }
    if (index === 2) {
      const ref = /textbox "Password" \[ref=([^\]]+)\]/.exec(results[1] ?? "")?.[1]
      if (!ref) return undefined
      return { name: "browser_type", args: { element: "the password field", target: ref, text: "hunter2" } }
    }
    // Read the field back: a rejected fill must leave it empty.
    if (index === 3)
      return { name: "browser_evaluate", args: { function: "() => document.querySelector('#pw').value" } }
    return undefined
  },
  "deny-click": (index, results) => {
    if (index === 0) return { name: "browser_navigate", args: { url: fixture.url.origin } }
    if (index === 1) return { name: "browser_snapshot", args: {} }
    if (index === 2) {
      const ref = /button "Click me" \[ref=([^\]]+)\]/.exec(results[1] ?? "")?.[1]
      if (!ref) return undefined
      return { name: "browser_click", args: { element: "the Click me button", target: ref } }
    }
    return undefined
  },
  // A `file:` target has no origin, so it has no grant to ask for: the call is refused before the browser opens it.
  "navigate-file": (index) => {
    if (index === 0) return { name: "browser_navigate", args: { url: "file:///etc/passwd" } }
    if (index === 1) return { name: "browser_navigate", args: { url: fixture.url.origin } }
    if (index === 2) return { name: "browser_evaluate", args: { function: "() => location.href" } }
    return undefined
  },
  // Read the inner origin on its own page first, so its grant exists when it later appears inside a withheld frame.
  nested: (index) => {
    if (index === 0) return { name: "browser_navigate", args: { url: inner.url.origin } }
    if (index === 1) return { name: "browser_snapshot", args: {} }
    if (index === 2) return { name: "browser_navigate", args: { url: fixture.url.origin } }
    if (index === 3) return { name: "browser_snapshot", args: {} }
    if (index === 4) return { name: "browser_console_messages", args: { level: "info" } }
    return undefined
  },
}

const record: { steps: Step[] } = { steps: [] }
const plan = plans[scenario.startsWith("sensitive") ? "sensitive" : scenario] ?? plans.frames

const sse = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } })

const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
    const body: unknown = await request.json()
    const name = typeof field(body, "model") === "string" ? (field(body, "model") as string) : "local"
    const declared = field(body, "tools")
    const tools = Array.isArray(declared)
      ? declared.flatMap((tool) => {
          const id = field(field(tool, "function"), "name")
          return typeof id === "string" ? [id] : []
        })
      : []
    if (!tools.some((tool) => tool.startsWith("browser_"))) return sse(text(name, "Browser E2E"))

    const step = read(field(body, "messages"))
    record.steps.push(step)
    const next = plan(step.results.length, step.results)
    if (!next) return sse(text(name, "Browser E2E finished"))
    return sse(toolCall(name, next.name, next.args))
  },
})

type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

const config = (input: { observation?: string; allowSensitive?: boolean; rules?: Rule[] }) => ({
  model: "local/echo",
  providers: {
    local: {
      name: "Local",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `${model.url.origin}/v1`, apiKey: "local-key" },
      models: { echo: { name: "Echo", limit: { context: 32000, output: 4000 } } },
    },
  },
  browser: {
    backend: "playwright",
    observation: input.observation ?? "full",
    headless: false,
    ...(input.allowSensitive ? { allow_sensitive: true } : {}),
  },
  ...(input.rules?.length ? { permissions: input.rules } : {}),
})

function environment(root: string, settings: { observation?: string; allowSensitive?: boolean; rules?: Rule[] }) {
  return {
    ...process.env,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_RUNTIME_DIR: path.join(root, "run"),
    KILO_CONFIG_CONTENT: JSON.stringify(config(settings)),
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
    KILO_AUTH_CONTENT: "",
    KILO_API_KEY: "",
    NO_PROXY: "127.0.0.1,127.0.0.2,localhost",
    no_proxy: "127.0.0.1,127.0.0.2,localhost",
  }
}

const failures: string[] = []
const expect = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

async function run(settings: { observation?: string; allowSensitive?: boolean; rules?: Rule[]; auto?: boolean }) {
  const root = process.env.E2E_HOME ?? (await fs.mkdtemp(path.join(os.tmpdir(), "browser-perm-")))
  await fs.mkdir(path.join(root, "data"), { recursive: true })
  record.steps = []
  const output = path.join(root, "data", "kilo2", "browser", "output")
  await fs.rm(output, { recursive: true, force: true }).catch(() => undefined)
  const child = Bun.spawn(
    [
      binary,
      "run",
      "Check the browser permissions.",
      "--model",
      "local/echo",
      "--standalone",
      "--format",
      "json",
      ...(settings.auto ? ["--auto"] : []),
    ],
    { env: environment(root, settings), stdout: "pipe", stderr: "pipe", timeout: 240_000 },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const last = record.steps.at(-1) ?? { calls: [], results: [] }
  return { root, stdout, stderr, code, last }
}

async function main() {
  page =
    scenario.startsWith("frames") || scenario === "ask-public" ? framed : scenario === "nested" ? nestedPage : simple
  const output: Record<string, unknown> = { scenario }

  if (scenario === "frames") {
    const result = await run({})
    const snapshot = result.last.results[1] ?? ""
    const shot = result.last.results[2] ?? ""
    const files = await fs
      .readdir(path.join(result.root, "data", "kilo2", "browser", "output"))
      .catch(() => [] as string[])
    output.snapshot = snapshot.slice(0, 300)
    output.shot = shot.slice(0, 300)
    output.files = files
    expect(
      snapshot.includes(`[origin withheld: ${frame.url.origin}]`),
      `the snapshot did not withhold the frame:\n${snapshot.slice(0, 400)}`,
    )
    expect(!snapshot.includes(MARKER), "the withheld frame's marker reached the snapshot")
    // No path to unmasked pixels leaves the backend for a page with a withheld frame: the file link is dropped and the
    // file itself is gone (the masked image is the only copy, and a unit test covers the blacking out).
    expect(!shot.includes("[Screenshot"), `the screenshot link was returned:\n${shot.slice(0, 300)}`)
    expect(
      files.filter((file) => file.endsWith(".png")).length === 0,
      `an unmasked screenshot was left on disk: ${files}`,
    )
    return output
  }

  if (scenario === "frames-allowed") {
    const result = await run({ rules: [{ action: "browser", resource: `read:${frame.url.origin}`, effect: "allow" }] })
    const snapshot = result.last.results[1] ?? ""
    const targeted = result.last.results[2] ?? ""
    const after = result.last.results[3] ?? ""
    const files = (await fs.readdir(path.join(result.root, "data", "kilo2", "browser", "output"))).filter((file) =>
      file.endsWith(".png"),
    )
    output.withheld = snapshot.slice(0, 300)
    output.targeted = targeted.slice(0, 300)
    output.after = after.slice(0, 400)
    output.files = files
    // The first snapshot withholds the frame; the call that targets it asks, the config rule allows it, and the retry
    // reports the frame's own snapshot. The next full snapshot and the screenshot see the granted frame.
    expect(snapshot.includes("origin withheld"), "the frame was not withheld before the grant")
    expect(after.includes(MARKER), `the granted frame's marker is missing:\n${after.slice(0, 400)}`)
    expect(files.length === 1, `the granted screenshot was not saved: ${files}`)
    if (files.length === 1) {
      const image = Png.decode(
        await fs.readFile(path.join(result.root, "data", "kilo2", "browser", "output", files[0])),
      )
      const at = (8 * image.width + 8) * image.channels
      const inside = [image.data[at], image.data[at + 1], image.data[at + 2]]
      output.inside = inside
      expect(
        inside[0] > 200 && inside[1] < 80 && inside[2] < 80,
        `the granted frame was not visible in the screenshot: ${inside}`,
      )
    }
    expect(result.code === 0, `run exited ${result.code}\n${result.stderr.slice(-1500)}`)
    return output
  }

  if (scenario === "ask-public") {
    const result = await run({})
    const navigate = result.last.results[0] ?? ""
    output.navigate = navigate.slice(0, 300)
    expect(
      navigate.includes("cannot ask the user for permission") || navigate.includes("Permission denied"),
      `a non-localhost navigation was not refused:\n${navigate.slice(0, 400)}`,
    )
    return output
  }

  if (scenario === "sensitive-auto") {
    const result = await run({ auto: true })
    output.results = result.last.results.map((value) => value.slice(0, 200))
    output.stream = `${result.stdout}\n${result.stderr}`.includes("browser_sensitive")
    expect(result.code !== 0, "the run survived a sensitive step that needs a person")
    expect(!result.last.results[2], "the password fill produced a tool result under --auto")
    return output
  }

  if (scenario === "sensitive-rejected") {
    const result = await run({})
    const typed = result.last.results[2] ?? ""
    const value = result.last.results[3] ?? ""
    output.type = typed.slice(0, 300)
    output.value = value.slice(0, 200)
    // The ask is a real permission request, and its rejection reaches the model as a tool error.
    expect(
      typed.includes("cannot ask the user for permission") || typed.includes("Permission denied"),
      `the fill was not rejected:\n${typed.slice(0, 300)}`,
    )
    // The field is still empty: the rejected step never reached the page.
    expect(/""/.test(value), `the password field is not empty after the rejection:\n${value.slice(0, 300)}`)
    return output
  }

  if (scenario === "sensitive-allowed") {
    const result = await run({ auto: true, allowSensitive: true })
    const typed = result.last.results[2] ?? ""
    output.type = typed.slice(0, 300)
    expect(typed.length > 0, "the password fill did not run with allow_sensitive")
    expect(!typed.includes('"type":"tool.execution"'), `the password fill failed:\n${typed.slice(0, 300)}`)
    return output
  }

  if (scenario === "deny-click") {
    const result = await run({ rules: [{ action: "browser_click", resource: "*", effect: "deny" }] })
    const click = result.last.results[2] ?? ""
    output.click = click.slice(0, 300)
    // A denied tool is not offered at all (the registry drops it); if it is offered anyway, the call is refused.
    expect(
      click.includes("browser_click") && (click.includes("Permission denied") || click.includes("currently available")),
      `a denied tool ran:\n${click.slice(0, 300)}`,
    )
    return output
  }

  if (scenario === "navigate-file") {
    const result = await run({})
    const refused = result.last.results[0] ?? ""
    const back = result.last.results[2] ?? ""
    output.refused = refused.slice(0, 300)
    output.back = back.slice(0, 200)
    // The refusal is a tool error the model can read, and it names the scheme it refused.
    expect(refused.includes("Navigation refused"), `the file: navigation was not refused:\n${refused.slice(0, 300)}`)
    expect(refused.includes("file:"), `the refusal does not name the scheme:\n${refused.slice(0, 300)}`)
    expect(!refused.includes("root:"), `the local file was read:\n${refused.slice(0, 300)}`)
    // The tab is still on the fixture: the refused call never navigated.
    expect(back.includes(fixture.url.origin), `the tab did not stay on the fixture:\n${back.slice(0, 300)}`)
    return output
  }

  if (scenario === "nested") {
    const rules: Rule[] = [
      { action: "browser", resource: `navigate:${inner.url.origin}`, effect: "allow" },
      { action: "browser", resource: `read:${inner.url.origin}`, effect: "allow" },
    ]
    const result = await run({ rules })
    const snapshot = result.last.results[3] ?? ""
    const console = result.last.results[4] ?? ""
    output.snapshot = snapshot.slice(0, 400)
    output.console = console.slice(0, 400)
    // The middle frame is withheld, so its subtree — including the granted inner frame — never reaches the snapshot.
    expect(snapshot.includes("origin withheld"), `the middle frame was not withheld:\n${snapshot.slice(0, 400)}`)
    expect(
      !snapshot.includes("INNER-MARKER"),
      `the inner frame's marker reached the snapshot:\n${snapshot.slice(0, 400)}`,
    )
    // Console output works for the page itself, and both withheld frames stay out of it.
    expect(console.includes("PAGE-CONSOLE-MARKER"), `the page's own console line is missing:\n${console.slice(0, 400)}`)
    expect(
      !console.includes("INNER-CONSOLE-MARKER"),
      `the nested frame's console line leaked:\n${console.slice(0, 400)}`,
    )
    expect(
      !console.includes("MIDDLE-CONSOLE-MARKER"),
      `the withheld frame's console line leaked:\n${console.slice(0, 400)}`,
    )
    return output
  }

  throw new Error(`unknown scenario ${scenario}`)
}

try {
  const report = await main()
  console.log(JSON.stringify({ ...report, failures }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  fixture.stop(true)
  inner.stop(true)
  middle.stop(true)
  frame.stop(true)
  model.stop(true)
}
