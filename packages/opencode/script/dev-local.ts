// kilocode_change - new file
// Launch the kilo CLI dev build against a locally running cloud dev server.
//   bun dev:local <project-dir> [--cloud <dir>] [--no-ingest] [--no-events] [--print] [-- <kilo args>]
//
// Reads ports from <cloud>/dev/logs/manifest.json (+ .dev-port), probes the web
// server, and points the CLI at it (KILO_API_URL / KILO_SESSION_INGEST_URL /
// EVENT_SERVICE_URL).
// Auth/config/state/cache are isolated under ~/.kilo-dev so it can't clash with
// your main kilo install; real HOME is kept so git/ssh still work.

import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import net from "node:net"

const kilo = path.resolve(import.meta.dir, "../../..")
const home = path.join(os.homedir(), ".kilo-dev")
const dim = "\x1b[2m", red = "\x1b[31m", grn = "\x1b[32m", ylw = "\x1b[33m", rst = "\x1b[0m"

function die(m: string): never {
  console.error(`${red}${m}${rst}`)
  process.exit(1)
}
const read = (f: string) => { try { return fs.readFileSync(f, "utf-8").trim() } catch { return undefined } }
function alive(port: number, ms = 2000) {
  return new Promise<boolean>((res) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => { clearTimeout(t); s.destroy(); res(true) })
    const t = setTimeout(() => { s.destroy(); res(false) }, ms)
    s.on("error", () => { clearTimeout(t); res(false) })
  })
}

function manifest(cloud: string) {
  try {
    const raw = JSON.parse(read(path.join(cloud, "dev", "logs", "manifest.json")) || "{}") as unknown
    return raw && typeof raw === "object" ? (raw as { services?: Array<{ name: string; port: number }> }) : {}
  } catch {
    return {}
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const sep = argv.indexOf("--")
  const local = sep >= 0 ? argv.slice(0, sep) : argv
  const pass = sep >= 0 ? argv.slice(sep + 1) : []
  let cloud = path.join(os.homedir(), "Projects", "cloud")
  let project = ""
  let noIngest = false
  let noEvents = false
  let dry = false
  for (let i = 0; i < local.length; i++) {
    const a = local[i]
    if (a === "--cloud") cloud = local[++i] ?? die("--cloud requires a value")
    else if (a === "--no-ingest") noIngest = true
    else if (a === "--no-events") noEvents = true
    else if (a === "--print") dry = true
    else if (!a.startsWith("--")) project = a
  }

  project = path.resolve(project || process.cwd())
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) die(`project directory not found: ${project}`)

  const m = manifest(cloud)
  const svc = (name: string) => m.services?.find((s) => s.name === name)?.port
  const webPort = Number(read(path.join(cloud, ".dev-port"))) || svc("nextjs")
  const ingestPort = noIngest ? undefined : svc("cloudflare-session-ingest")
  const eventsPort = noEvents ? undefined : svc("event-service")
  if (!webPort) die(`no web port found in ${cloud} — is the dev server started? (pnpm dev:start)`)

  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [k, d] of [["XDG_DATA_HOME", "data"], ["XDG_CONFIG_HOME", "config"], ["XDG_STATE_HOME", "state"], ["XDG_CACHE_HOME", "cache"]] as const) {
    const p = path.join(home, d); fs.mkdirSync(p, { recursive: true }); env[k] = p
  }
  env.KILO_API_URL = `http://localhost:${webPort}`
  env.KILO_DEV_CWD = project
  env.KILO_DISABLE_AUTOUPDATE = "1"
  if (ingestPort) env.KILO_SESSION_INGEST_URL = `http://localhost:${ingestPort}`
  else env.KILO_DISABLE_SESSION_INGEST = "1"
  if (eventsPort) env.EVENT_SERVICE_URL = `ws://localhost:${eventsPort}`
  else env.KILO_DISABLE_PRESENCE = "1"

  const webUp = await alive(webPort)
  console.log(`${dim}project${rst}  ${project}`)
  console.log(`${dim}web${rst}      :${webPort}  ${webUp ? `${grn}up${rst}` : `${red}down${rst}`}`)
  console.log(`${dim}ingest${rst}   ${ingestPort ? `:${ingestPort}` : "off"}`)
  console.log(`${dim}events${rst}   ${eventsPort ? `:${eventsPort}` : "off"}`)
  console.log(`${dim}home${rst}     ${home}`)

  if (dry) { if (!webUp) console.warn(`${ylw}web down — start it (pnpm dev:start)${rst}`); return }
  if (!webUp) die(`web on :${webPort} is not responding — start it first (pnpm dev:start)`)

  process.exit(await Bun.spawn({ cmd: ["bun", "run", "--cwd", "packages/opencode", "--conditions=browser", "src/index.ts", ...pass], cwd: kilo, env, stdio: ["inherit", "inherit", "inherit"] }).exited)
}

void main().catch((e) => die(e instanceof Error ? e.message : String(e)))
