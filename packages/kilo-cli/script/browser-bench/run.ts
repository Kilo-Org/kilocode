/**
 * Browser benchmark: runs the built `kilo2 run` against local fixture pages for every task × repetition × backend,
 * then writes one JSONL row per run and a Markdown summary.
 *
 *   xvfb-run -a bun --env-file=<file with OPENROUTER_API_KEY> script/browser-bench/run.ts \
 *     --binary <kilo2> --backends playwright,extension --runs 3 --out <dir>
 *
 * Options: --tasks <ids or groups>, --model <provider/model>, --observation full|diff|none (default: unset, so the
 * CLI's own default applies), --timeout <s>, --budget <USD>, --extension <built chrome-mv3 dir>, --chromium <path>,
 * --ports <from-to> (hub port range), --port <fixture port>, --downloads-ungranted (load the shipped manifest instead
 * of the accepted-Downloads-permission state), --code-mode (allow Code Mode's `execute`, the v2 default tool surface;
 * without it the model calls the browser_* tools directly).
 *
 * Backends are interleaved per task and repetition (task1/extension, task1/playwright, task2/extension, ...), so host
 * load hits both alike. Every run is its own CLI session with fresh XDG directories. The extension backend uses one
 * Chromium with the built extension and one loopback hub for the whole matrix. Every tool but the browser tools is
 * denied, so the browser is the only way to reach the fixtures.
 *
 * The playwright backend needs the Chromium build of the CLI's playwright-core: set PLAYWRIGHT_BROWSERS_PATH to a
 * directory that has it (each run's Kilo browser directory links there). Headless follows the CLI's default for the
 * environment; SSH variables are removed from the runs' environment, so under xvfb both backends run headed, as on a
 * desktop.
 */
import { appendFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { answerOf, task as findTask, TASKS, type Task } from "./fixtures"
import { launchExtensionBrowser, type ExtensionBrowser } from "./extension"
import { errorName, renderSummary, type Row, type ToolError } from "./report"
import { serve } from "./server"

type Backend = "playwright" | "extension"

const BACKENDS: Backend[] = ["extension", "playwright"]
const DEFAULT_MODEL = "openrouter/deepseek/deepseek-v4.1-flash-1017"

function parseArgs(argv: string[]) {
  const read = (name: string) => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const list = (value: string | undefined) =>
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  const requested = list(read("tasks"))
  const binary = read("binary") ?? process.env.KILO_BIN
  if (!binary) throw new Error("pass --binary <kilo2> or set KILO_BIN")
  const backends = (list(read("backends")) ?? BACKENDS) as Backend[]
  for (const backend of backends) {
    if (!BACKENDS.includes(backend)) throw new Error(`unknown backend ${backend}; choose ${BACKENDS.join(", ")}`)
  }
  const ports = read("ports")?.split("-").map(Number)
  return {
    binary: resolve(binary),
    backends,
    tasks: requested
      ? TASKS.filter((task) => requested.includes(task.id) || requested.includes(task.group)).map((task) => task.id)
      : TASKS.map((task) => task.id),
    runs: Number(read("runs") ?? 3),
    model: read("model") ?? DEFAULT_MODEL,
    observation: read("observation"),
    out: resolve(read("out") ?? join("/tmp/browser-bench", new Date().toISOString().replace(/[:.]/g, "-"))),
    timeout: Number(read("timeout") ?? 300),
    budget: Number(read("budget") ?? 10),
    extension: read("extension") ?? process.env.E2E_EXTENSION_DIR,
    chromium: read("chromium") ?? process.env.E2E_CHROMIUM,
    ports: ports?.length === 2 ? (ports as [number, number]) : undefined,
    port: Number(read("port") ?? 0),
    ungranted: argv.includes("--downloads-ungranted"),
    codeMode: argv.includes("--code-mode"),
  }
}

type Args = ReturnType<typeof parseArgs>

/**
 * v2 config: the backend under test, the observation default unless asked, and browser tools as the only tools.
 * Denying every tool also turns Code Mode off (core/src/tool.ts: Code Mode is on unless `execute` is wholly denied),
 * so the model calls the browser_* tools directly; `--code-mode` allows `execute`, the v2 default surface, where the
 * browser tools are reached through it.
 */
function config(args: Args, backend: Backend) {
  return {
    model: args.model,
    browser: { backend, ...(args.observation ? { observation: args.observation } : {}) },
    permissions: [
      { action: "*", effect: "deny", resource: "*" },
      ...(args.codeMode ? [{ action: "execute", effect: "allow", resource: "*" }] : []),
      { action: "browser_*", effect: "allow", resource: "*" },
      // Other origins (about:blank, a new tab) stay an ask, which `--auto` approves, as a user's default would.
      { action: "browser", effect: "ask", resource: "*" },
      // The fixtures are loopback-only; every browser class is allowed there so no run waits on a prompt.
      { action: "browser", effect: "allow", resource: "*:http://127.0.0.1:*" },
      { action: "browser", effect: "allow", resource: "*:http://localhost:*" },
    ],
  }
}

type Metrics = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  listCost: number
  turns: number
  tools: number
  browser: number
  execute: number
  resultBytesByTool: Record<string, { calls: number; bytes: number }>
  browserTools: Record<string, number>
  toolErrors: ToolError[]
  resultBytes: number
  resultImages: number
  text: string
  error: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8")

/** USD per token. */
type Price = { prompt: number; completion: number; cacheRead: number; cacheWrite: number }
type Pricing = { base: Price; overrides: { days: string[]; start: number; end: number; price: Price }[] }

/**
 * The model's OpenRouter list prices, with its time-of-day overrides. The CLI records what the endpoint reports it
 * charged, which is zero for a call on the account's own provider key (BYOK), so the list price is the spend estimate.
 */
async function openRouterPricing(model: string): Promise<Pricing | undefined> {
  if (!model.startsWith("openrouter/")) return undefined
  const id = model.slice("openrouter/".length)
  const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) }).catch(
    () => undefined,
  )
  const list = record(await response?.json().catch(() => undefined))?.["data"]
  const pricing = record(
    record(Array.isArray(list) ? list.find((item) => record(item)?.["id"] === id) : undefined)?.["pricing"],
  )
  if (!pricing) return undefined
  const price = (value: Record<string, unknown>, fallback?: Price): Price => ({
    prompt: Number(value["prompt"] ?? fallback?.prompt ?? 0),
    completion: Number(value["completion"] ?? fallback?.completion ?? 0),
    cacheRead: Number(value["input_cache_read"] ?? fallback?.cacheRead ?? 0),
    cacheWrite: Number(value["input_cache_write"] ?? fallback?.cacheWrite ?? 0),
  })
  const base = price(pricing)
  const overrides = Array.isArray(pricing["overrides"]) ? pricing["overrides"] : []
  return {
    base,
    overrides: overrides.flatMap((item) => {
      const value = record(item)
      if (!value) return []
      const days = Array.isArray(value["utc_days"]) ? value["utc_days"].map(String) : []
      // utc_start / utc_end are HHMM; an end of 0 is midnight.
      return [
        { days, start: Number(value["utc_start"] ?? 0), end: Number(value["utc_end"] ?? 0), price: price(value, base) },
      ]
    }),
  }
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

function priceAt(pricing: Pricing, time: number): Price {
  const date = new Date(time)
  const day = DAYS[date.getUTCDay()]
  const clock = date.getUTCHours() * 100 + date.getUTCMinutes()
  const found = pricing.overrides.find(
    (item) => item.days.includes(day) && clock >= item.start && (item.end === 0 || clock < item.end),
  )
  return found?.price ?? pricing.base
}

/** Totals from `kilo2 run --format json`: step, tool, text and error events, one JSON object per line. */
function parseRun(stdout: string, pricing: Pricing | undefined): Metrics {
  const metrics: Metrics = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    listCost: 0,
    turns: 0,
    tools: 0,
    browser: 0,
    execute: 0,
    resultBytesByTool: {},
    browserTools: {},
    toolErrors: [],
    resultBytes: 0,
    resultImages: 0,
    text: "",
    error: "",
  }
  const texts = new Map<string, string>()
  const errors: string[] = []
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue
    let event: Record<string, unknown> | undefined
    try {
      event = record(JSON.parse(line))
    } catch {
      continue
    }
    const part = record(event?.["part"])
    const type = event?.["type"]
    if (type === "step_start") metrics.turns += 1
    if (type === "step_finish") {
      const tokens = record(part?.["tokens"])
      const cache = record(tokens?.["cache"])
      const step = {
        input: Number(tokens?.["input"] ?? 0),
        output: Number(tokens?.["output"] ?? 0),
        reasoning: Number(tokens?.["reasoning"] ?? 0),
        cacheRead: Number(cache?.["read"] ?? 0),
        cacheWrite: Number(cache?.["write"] ?? 0),
      }
      metrics.input += step.input
      metrics.output += step.output
      metrics.reasoning += step.reasoning
      metrics.cacheRead += step.cacheRead
      metrics.cacheWrite += step.cacheWrite
      metrics.cost += Number(part?.["cost"] ?? 0)
      if (pricing) {
        const price = priceAt(pricing, Number(event?.["timestamp"] ?? Date.now()))
        metrics.listCost +=
          step.input * price.prompt +
          (step.output + step.reasoning) * price.completion +
          step.cacheRead * price.cacheRead +
          step.cacheWrite * price.cacheWrite
      }
    }
    if (type === "tool_use") {
      const tool = String(part?.["tool"] ?? "")
      const state = record(part?.["state"])
      // Code Mode reports the calls one `execute` made as `tools.browser.<name>` in its metadata.
      const inner = record(record(state?.["metadata"])?.["metadata"])?.["toolCalls"]
      const calls = tool === "execute" && Array.isArray(inner) ? inner.map(record) : []
      const innerBrowser = calls.filter((call) => String(call?.["tool"] ?? "").startsWith("browser."))
      const browser = tool.startsWith("browser_") || innerBrowser.length > 0
      metrics.tools += 1
      if (tool === "execute") metrics.execute += 1
      if (tool.startsWith("browser_")) {
        metrics.browser += 1
        metrics.browserTools[tool] = (metrics.browserTools[tool] ?? 0) + 1
      }
      for (const call of innerBrowser) {
        const name = String(call?.["tool"]).replace(".", "_")
        metrics.browser += 1
        metrics.browserTools[name] = (metrics.browserTools[name] ?? 0) + 1
        // A failed inner call usually fails the whole `execute`, which is recorded once below.
        if (call?.["status"] === "error" && state?.["status"] !== "error") {
          const text = String(call["error"] ?? "inner call failed")
          metrics.toolErrors.push({ tool: name, name: errorName(text), text: text.slice(0, 200) })
        }
      }
      // An `execute` result belongs to one browser tool only when it made exactly one browser call.
      const owner = tool.startsWith("browser_")
        ? tool
        : innerBrowser.length === 1
          ? String(innerBrowser[0]?.["tool"]).replace(".", "_")
          : "execute (several browser calls)"
      let size = 0
      if (state?.["status"] === "error") {
        const text = String(state["error"] ?? "")
        metrics.toolErrors.push({ tool, name: errorName(text), text: text.slice(0, 200) })
        size = bytes(text)
      }
      if (state?.["status"] === "completed") {
        const content = record(state["metadata"])?.["content"]
        if (Array.isArray(content)) {
          for (const block of content.map(record)) {
            if (block?.["type"] === "text") size += bytes(String(block["text"] ?? ""))
            else if (block && browser) metrics.resultImages += 1
          }
        } else size = bytes(String(state["output"] ?? ""))
      }
      if (browser) {
        metrics.resultBytes += size
        const entry = metrics.resultBytesByTool[owner] ?? { calls: 0, bytes: 0 }
        metrics.resultBytesByTool[owner] = { calls: entry.calls + 1, bytes: entry.bytes + size }
      }
    }
    if (type === "text") {
      const id = String(part?.["id"] ?? "")
      texts.set(id, (texts.get(id) ?? "") + String(part?.["text"] ?? ""))
    }
    if (type === "error") errors.push(JSON.stringify(event?.["error"] ?? "error").slice(0, 400))
  }
  metrics.text = [...texts.values()].join("\n")
  metrics.error = errors.join(" | ")
  return metrics
}

async function loadAverage() {
  const text = await readFile("/proc/loadavg", "utf8").catch(() => "")
  return Number(text.split(" ")[0] ?? 0) || 0
}

/** The runs' environment: no SSH variables (headless then follows the display), no Kilo credentials. */
function baseEnvironment() {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || name.startsWith("SSH_")) continue
    env[name] = value
  }
  return env
}

async function runOnce(input: {
  pricing: Pricing | undefined
  args: Args
  backend: Backend
  task: Task
  base: string
  root: string
  extension: ExtensionBrowser | undefined
}) {
  const { args, backend, task, root } = input
  const data = join(root, "data")
  await mkdir(join(root, "work"), { recursive: true })
  if (backend === "playwright" && process.env.PLAYWRIGHT_BROWSERS_PATH) {
    await mkdir(join(data, "kilo2", "browser"), { recursive: true })
    await symlink(process.env.PLAYWRIGHT_BROWSERS_PATH, join(data, "kilo2", "browser", "browsers"))
  }
  const started = performance.now()
  const proc = Bun.spawn(
    [
      args.binary,
      "run",
      `${task.instruction}\n\nPage: ${input.base}/t/${task.id}`,
      "--model",
      args.model,
      "--standalone",
      "--format",
      "json",
      "--auto",
    ],
    {
      cwd: join(root, "work"),
      env: {
        ...baseEnvironment(),
        HOME: root,
        // The CLI takes its location from PWD when set; the inherited one would be the harness's directory.
        PWD: join(root, "work"),
        XDG_DATA_HOME: data,
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_STATE_HOME: join(root, "state"),
        XDG_CACHE_HOME: join(root, "cache"),
        KILO_API_KEY: "",
        KILO_AUTH_CONTENT: "",
        KILO_DISABLE_AUTOUPDATE: "1",
        KILO_CONFIG_CONTENT: JSON.stringify(config(args, backend)),
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        ...(input.extension?.environment() ?? {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const timer = setTimeout(() => proc.kill("SIGKILL"), args.timeout * 1000)
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  const wallMs = Math.round(performance.now() - started)
  const metrics = parseRun(stdout, input.pricing)
  return { answer: answerOf(metrics.text), wallMs, exit, metrics, stdout, stderr }
}

/** A killed run can leave its Chromium behind; the run's own data path identifies it. */
async function reap(root: string) {
  if (process.platform !== "linux") return
  await Bun.spawn(["pkill", "-f", join(root, "data")], { stdout: "ignore", stderr: "ignore" }).exited
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.tasks.length === 0) throw new Error("no tasks selected")
  const fixtures = serve(args.port)
  await mkdir(join(args.out, "logs"), { recursive: true })
  const rowsPath = join(args.out, "runs.jsonl")
  await writeFile(rowsPath, "")
  const pricing = await openRouterPricing(args.model)

  console.log(`fixtures ${fixtures.url}`)
  console.log(`matrix: ${args.runs} runs × ${args.tasks.length} tasks × ${args.backends.join("/")}`)
  console.log(`kilo2: ${args.binary}; model ${args.model}; observation ${args.observation ?? "default"}`)
  console.log(`out: ${args.out}`)
  console.log(`list pricing: ${pricing ? JSON.stringify(pricing.base) : "unavailable (only CLI-recorded cost)"}`)

  let extension: ExtensionBrowser | undefined
  if (args.backends.includes("extension")) {
    if (!args.extension) throw new Error("the extension backend needs --extension <built chrome-mv3 dir>")
    extension = await launchExtensionBrowser({
      binary: args.binary,
      root: join(args.out, "extension"),
      extension: resolve(args.extension),
      chromium: args.chromium,
      ports: args.ports,
      ungranted: args.ungranted,
    })
    console.log(`extension ${extension.extensionId} paired`)
  }

  const rows: Row[] = []
  const total = args.runs * args.tasks.length * args.backends.length
  let stopped = ""
  let groups = ""
  try {
    for (let run = 1; run <= args.runs && !stopped; run++) {
      for (const id of args.tasks) {
        if (stopped) break
        const task = findTask(id)
        for (const backend of args.backends) {
          const slug = `${backend}__${task.id}__${run}`
          const root = join(args.out, "runs", slug)
          let repaired = false
          if (backend === "extension" && extension) repaired = (await extension.ensurePaired()).repaired
          fixtures.reset()
          const load = await loadAverage()
          const result = await runOnce({ args, backend, task, base: fixtures.url, root, extension, pricing })
          let success = false
          try {
            success = task.check({ records: fixtures.records(task.id), answer: result.answer })
          } catch {
            success = false
          }
          const tabsAfter = backend === "extension" && extension ? await extension.tabCount().catch(() => -2) : -1
          const log = join("logs", `${slug}.jsonl`)
          const row: Row = {
            backend,
            model: args.model,
            observation: args.observation ?? "default",
            surface: args.codeMode ? "code-mode" : "direct",
            task: task.id,
            group: task.group,
            run,
            success,
            input: result.metrics.input,
            output: result.metrics.output,
            reasoning: result.metrics.reasoning,
            cacheRead: result.metrics.cacheRead,
            cacheWrite: result.metrics.cacheWrite,
            cost: result.metrics.cost,
            listCost: result.metrics.listCost,
            turns: result.metrics.turns,
            toolCalls: result.metrics.tools,
            browserCalls: result.metrics.browser,
            executeCalls: result.metrics.execute,
            browserTools: result.metrics.browserTools,
            toolErrors: result.metrics.toolErrors,
            resultBytes: result.metrics.resultBytes,
            resultBytesByTool: result.metrics.resultBytesByTool,
            resultImages: result.metrics.resultImages,
            wallMs: result.wallMs,
            load,
            tabsAfter,
            exit: result.exit,
            answer: result.answer.slice(0, 120),
            error: [
              repaired ? "hub re-paired before this run" : "",
              result.exit === 0
                ? result.metrics.error.slice(0, 300)
                : `exit ${result.exit}: ${result.stderr.slice(-300)}`,
            ]
              .filter(Boolean)
              .join("; "),
            log,
          }
          rows.push(row)
          await appendFile(rowsPath, JSON.stringify(row) + "\n")
          await writeFile(join(args.out, log), result.stdout)
          await writeFile(join(args.out, "logs", `${slug}.stderr`), result.stderr.slice(-50_000))
          console.log(
            `[${rows.length}/${total}] ${backend} ${task.id} #${run} ${success ? "PASS" : "FAIL"} ` +
              `${row.input + row.output + row.cacheRead + row.cacheWrite}tok ${row.turns}turn ${row.browserCalls}calls ` +
              `${row.toolErrors.length}err ${row.wallMs}ms load ${load} cli $${row.cost.toFixed(4)} list $${row.listCost.toFixed(4)}` +
              (row.tabsAfter >= 0 ? ` tabs ${row.tabsAfter}` : ""),
          )
          await reap(root)
          const spent = Math.max(
            rows.reduce((sum, item) => sum + item.cost, 0),
            rows.reduce((sum, item) => sum + item.listCost, 0),
          )
          if (spent >= args.budget * 0.9) {
            stopped = `stopped at ${rows.length}/${total}: spend $${spent.toFixed(4)} reached 90% of the $${args.budget} budget`
            console.log(stopped)
            break
          }
        }
      }
    }
  } finally {
    fixtures.stop()
    if (extension) {
      const titles = await extension.groupTitles().catch(() => [] as string[])
      const counts = new Map<string, number>()
      for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1)
      groups = [...counts].map(([title, count]) => `${count} × "${title}"`).join(", ") || "none"
      await writeFile(join(args.out, "logs", "hub.log"), extension.hubLog())
      await extension.close()
    }
  }
  const spend =
    `CLI-recorded cost: $${rows.reduce((sum, row) => sum + row.cost, 0).toFixed(4)}. ` +
    (pricing
      ? `OpenRouter list price of the recorded tokens (time-of-day overrides applied): $${rows.reduce((sum, row) => sum + row.listCost, 0).toFixed(4)}.`
      : "No list pricing for this model.")
  const summary =
    `${renderSummary(rows)}\n` +
    (groups ? `## Extension tab groups at the end\n\n${groups}\n\n` : "") +
    `## Spend\n\n${spend}\n${stopped ? `\n${stopped}\n` : ""}`
  await writeFile(join(args.out, "summary.md"), summary)
  console.log(`\n${summary}`)
  console.log(`\nwrote ${rowsPath}`)
}

await main()
