#!/usr/bin/env bun

import { chmod, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises"
import { userInfo } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { desktop } from "./desktop"
import { capture, Client } from "./mcp"

const artifacts = {
  idea: {
    file: "idea-2026.1.tar.gz",
    url: "https://download.jetbrains.com/idea/idea-2026.1.tar.gz",
    sha: "f57d3dba9970c774cf377583629aea540418e677ec6365570e76dea9cb2f3f9b",
  },
  kilo: {
    file: "kilo-7.1.12.zip",
    url: "https://github.com/Kilo-Org/kilocode/releases/download/jetbrains/v7.1.12/kilo.jetbrains-7.1.12-signed.zip",
    sha: "380bcdf4508cf508f1d1821419a57966a67cb29983b5c4dcd9598e6d3cdcf2c0",
  },
  steroid: {
    file: "mcp-steroid-0.102.zip",
    url: "https://github.com/jonnyzzz/mcp-steroid/releases/download/v0.102/mcp-steroid-0.102.0-r-c68d8f15d.zip",
    sha: "e5d5b3330f8473fa015d8c18756e687d8ed7f72c6af42a8ccb1bc6706af63bd5",
  },
}

const packages = [
  "tigervnc-standalone-server",
  "openbox",
  "novnc",
  "dbus-x11",
  "util-linux",
  "passwd",
  "unzip",
  "ca-certificates",
  "fonts-dejavu-core",
  "fonts-liberation",
  "libasound2t64",
  "libgbm1",
  "libnss3",
  "libxtst6",
  "libxrender1",
  "libxi6",
  "libfreetype6",
  "libfontconfig1",
  "libgtk-3-0t64",
  "libcups2t64",
]

type Config = ReturnType<typeof options>
type State = { pid: number; stamp: string; config: Config }

function options(args: string[], cwd = process.cwd(), saved: Record<string, unknown> = {}) {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      ide: { type: "string" },
      project: { type: "string" },
      user: { type: "string" },
      host: { type: "string" },
      origin: { type: "string" },
      port: { type: "string" },
      display: { type: "string" },
      "vnc-port": { type: "string" },
      "mcp-port": { type: "string" },
      "with-kilo": { type: "boolean" },
      "kilo-zip": { type: "string" },
      "steroid-zip": { type: "string" },
      ca: { type: "string" },
      "skip-deps": { type: "boolean" },
      settings: { type: "boolean" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  })
  const values = parsed.values
  const dir = resolve(cwd, values.dir ?? String(saved.dir ?? ".kilo-dev/jetbrains-sandbox"))
  if (dir === "/" || dir === resolve(cwd))
    throw new Error("Use a dedicated state directory, not the workspace or filesystem root")
  const number = (value: string | undefined, fallback: number, name: string) => {
    const result = value == null ? fallback : Number(value)
    if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error(`Invalid ${name}: ${value}`)
    return result
  }
  const cmd = parsed.positionals.at(0) ?? "help"
  const user = values.user ?? String(saved.user ?? (process.getuid?.() === 0 ? "ideuser" : userInfo().username))
  if (user === "root" || !/^[a-z_][a-z0-9_-]*[$]?$/.test(user)) throw new Error(`A non-root user is required: ${user}`)
  const display = Number(values.display ?? saved.display ?? 99)
  if (!Number.isInteger(display) || display < 1 || display > 999) throw new Error("Display must be between 1 and 999")
  const port = number(values.port, cmd === "serve" ? 6083 : Number(saved.port ?? 6080), "port")
  const vnc = number(values["vnc-port"], Number(saved.vnc ?? 5999), "VNC port")
  const mcp = number(values["mcp-port"], Number(saved.mcp ?? 6315), "MCP port")
  if (new Set([port, vnc, mcp]).size !== 3) throw new Error("Viewer, VNC and MCP ports must be distinct")
  const path = (value: unknown) => (value == null || value === "" ? undefined : resolve(cwd, String(value)))
  const origin = values.origin ?? saved.origin
  const trusted = origin == null ? undefined : new URL(String(origin))
  if (
    trusted &&
    (!["http:", "https:"].includes(trusted.protocol) ||
      trusted.username ||
      trusted.password ||
      trusted.pathname !== "/" ||
      trusted.search ||
      trusted.hash)
  ) {
    throw new Error("--origin must be a trusted http(s) origin without a path or credentials")
  }
  return {
    cmd,
    dir,
    user,
    display,
    port,
    vnc,
    mcp,
    ide: path(values.ide ?? saved.ide) ?? join(dir, "idea"),
    project: path(values.project ?? saved.project) ?? join(dir, "project"),
    host: values.host ?? String(saved.host ?? "127.0.0.1"),
    origin: trusted?.origin,
    addon: values["with-kilo"] ?? (values["kilo-zip"] != null || saved.addon === true || saved.kilo != null),
    kilo: path(values["kilo-zip"] ?? saved.kilo),
    steroid: path(values["steroid-zip"] ?? saved.steroid),
    ca: path(values.ca ?? saved.ca ?? process.env.NODE_EXTRA_CA_CERTS),
    skipdeps: values["skip-deps"] ?? false,
    settings: values.settings ?? false,
    out: path(values.out) ?? join(dir, "screenshot.png"),
    target: values.project,
    args: parsed.positionals.slice(1),
    help: values.help ?? false,
  }
}

function environment(config: Config) {
  return {
    HOME: join(config.dir, "home"),
    USER: config.user,
    LOGNAME: config.user,
    PATH: `${join(config.ide, "jbr/bin")}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    LANG: "C.UTF-8",
    DISPLAY: `:${config.display}`,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(config.dir, "run/bus")}`,
    XDG_RUNTIME_DIR: join(config.dir, "run"),
    IDEA_PROPERTIES: join(config.dir, "idea.properties"),
    ...(config.ca ? { NODE_EXTRA_CA_CERTS: join(config.dir, "ca.crt") } : {}),
  }
}

async function checksum(path: string, expected?: string) {
  const hash = new Bun.CryptoHasher("sha256")
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk)
  const value = hash.digest("hex")
  if (expected && value !== expected) throw new Error(`Checksum mismatch for ${path}: ${value}`)
  return value
}

async function exec(cmd: string[], quiet = false, timeout = 180_000) {
  const proc = Bun.spawn(cmd, {
    stdout: quiet ? "pipe" : "inherit",
    stderr: quiet ? "pipe" : "inherit",
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
  })
  const output = quiet ? new Response(proc.stdout as ReadableStream).text() : Promise.resolve("")
  const error = quiet ? new Response(proc.stderr as ReadableStream).text() : Promise.resolve("")
  const timer = setTimeout(() => proc.kill("SIGTERM"), timeout)
  const [code, text, detail] = await Promise.all([proc.exited, output, error]).finally(() => clearTimeout(timer))
  if (code !== 0) throw new Error(`${cmd.at(0)} exited ${code}${detail ? `: ${detail}` : ""}`)
  return text
}

async function stamp(pid: number) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  return text
    ?.slice(text.lastIndexOf(")") + 2)
    .split(" ")
    .at(19)
}

async function state(dir: string) {
  const file = Bun.file(join(dir, "run.json"))
  if (!(await file.exists())) return undefined
  const value = (await file.json()) as State
  return (await stamp(value.pid)) === value.stamp ? value : undefined
}

async function download(config: Config, key: keyof typeof artifacts) {
  const item = artifacts[key]
  const path = join(config.dir, "downloads", item.file)
  if (await Bun.file(path).exists()) {
    await checksum(path, item.sha)
    return path
  }
  console.log(`Download ${item.url}`)
  const res = await fetch(item.url, { signal: AbortSignal.timeout(30 * 60_000) })
  if (!res.ok) throw new Error(`Download HTTP ${res.status}: ${item.url}`)
  await Bun.write(`${path}.part`, res)
  await checksum(`${path}.part`, item.sha)
  await rename(`${path}.part`, path)
  return path
}

async function install(config: Config) {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("This setup supports Linux x86-64 only")
  if (await state(config.dir)) throw new Error("Stop this sandbox before replacing its IDE or plugin files")
  await mkdir(config.dir, { recursive: true })
  const owner = join(config.dir, ".jetbrains-sandbox")
  if (!(await Bun.file(owner).exists())) {
    if ((await readdir(config.dir)).length)
      throw new Error(`Refusing non-empty, unowned state directory: ${config.dir}`)
    await Bun.write(owner, "kilo-jetbrains-sandbox\n")
  }
  if ((await Bun.file(owner).text()) !== "kilo-jetbrains-sandbox\n") throw new Error("Invalid state directory marker")
  if (!config.skipdeps) {
    if (process.getuid?.() !== 0)
      throw new Error("Install OS dependencies as root, or use --skip-deps after an administrator installs them")
    await exec(["apt-get", "update"], false, 30 * 60_000)
    await exec(["apt-get", "install", "-y", "--no-install-recommends", ...packages], false, 30 * 60_000)
  }
  for (const name of ["Xtigervnc", "openbox", "dbus-daemon", "tar", "unzip"]) {
    if (!Bun.which(name)) throw new Error(`Missing ${name}; install OS dependencies before using --skip-deps`)
  }
  if (!(await Bun.file("/usr/share/novnc/core/rfb.js").exists()))
    throw new Error("Missing noVNC; install the novnc package")
  for (const name of ["downloads", "config/plugins", "system", "log", "home", "run", "project", "screenshots"]) {
    await mkdir(join(config.dir, name), { recursive: true })
  }
  if (!(await Bun.file(join(config.ide, "product-info.json")).exists())) {
    if (config.ide !== join(config.dir, "idea")) throw new Error(`IDE installation not found: ${config.ide}`)
    const archive = await download(config, "idea")
    const stage = join(config.dir, "idea.part")
    await rm(stage, { recursive: true, force: true })
    await mkdir(stage, { recursive: true })
    await exec(["tar", "-xzf", archive, "--strip-components=1", "-C", stage], false, 30 * 60_000)
    await rename(stage, config.ide)
  }
  const product = (await Bun.file(join(config.ide, "product-info.json")).json()) as {
    version: string
    buildNumber: string
  }
  if (!product.buildNumber.startsWith("261."))
    throw new Error(`Pinned plugins require IDEA 2026.1 (261.*), found ${product.version}`)
  for (const [key, name, supplied] of [
    ["kilo", "kilo.jetbrains", config.kilo],
    ["steroid", "mcp-steroid", config.steroid],
  ] as const) {
    if (key === "kilo" && !config.addon) continue
    const archive = supplied ?? (await download(config, key))
    const hash = await checksum(archive, supplied ? undefined : artifacts[key].sha)
    const marker = join(config.dir, `${key}.sha256`)
    const target = join(config.dir, "config/plugins", name)
    const present = await stat(join(target, "lib"))
      .then((value) => value.isDirectory())
      .catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return false
        throw err
      })
    if ((await Bun.file(marker).exists()) && (await Bun.file(marker).text()).trim() === hash && present) continue
    const entries = (await exec(["unzip", "-Z1", archive], true)).trim().split("\n")
    if (
      entries.some(
        (entry) =>
          isAbsolute(entry) ||
          entry.includes("\\") ||
          entry.split("/").includes("..") ||
          entry.split("/").at(0) !== name,
      )
    ) {
      throw new Error(`Unexpected plugin archive layout: ${archive}`)
    }
    await rm(target, { recursive: true, force: true })
    await exec(["unzip", "-q", archive, "-d", join(config.dir, "config/plugins")])
    await Bun.write(marker, `${hash}\n`)
  }
  if (config.ca) {
    await Bun.write(join(config.dir, "ca.crt"), Bun.file(config.ca))
    const store = join(config.dir, "cacerts")
    if (!(await Bun.file(store).exists()))
      await Bun.write(store, Bun.file(join(config.ide, "jbr/lib/security/cacerts")))
    const alias = `kilo-sandbox-${(await checksum(config.ca)).slice(0, 16)}`
    const keytool = join(config.ide, "jbr/bin/keytool")
    const exists = await Bun.spawn([keytool, "-list", "-keystore", store, "-storepass", "changeit", "-alias", alias], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited
    if (exists !== 0)
      await exec([
        keytool,
        "-importcert",
        "-keystore",
        store,
        "-storepass",
        "changeit",
        "-alias",
        alias,
        "-file",
        config.ca,
        "-noprompt",
      ])
  }
  await Bun.write(
    join(config.dir, "idea.properties"),
    [
      `idea.config.path=${join(config.dir, "config")}`,
      `idea.plugins.path=${join(config.dir, "config/plugins")}`,
      `idea.system.path=${join(config.dir, "system")}`,
      `idea.log.path=${join(config.dir, "log")}`,
      "idea.initially.ask.config=false",
      "idea.show.tips.on.startup.default.value=false",
      "platform.feedback=false",
      "csat.survey.enabled=false",
      "editor.ux.survey.enabled=false",
      ...(config.addon ? ["kilo.dev.storage.isolated=true", `kilo.dev.worktree.root=${join(config.dir, "home")}`] : []),
      ...(config.ca ? [`javax.net.ssl.trustStore=${join(config.dir, "cacerts")}`] : []),
      "mcp.steroid.server.host=127.0.0.1",
      `mcp.steroid.server.port=${config.mcp}`,
      "mcp.steroid.dialog.killer.enabled=false",
      "",
    ].join("\n"),
  )
  if (!(await Bun.file(join(config.project, ".")).stat()).isDirectory())
    throw new Error(`Project is not a directory: ${config.project}`)
  if (process.getuid?.() === 0) {
    const exists = await Bun.spawn(["id", "-u", config.user], { stdout: "ignore", stderr: "ignore" }).exited
    if (exists !== 0)
      await exec([
        "useradd",
        "--system",
        "--user-group",
        "--home-dir",
        join(config.dir, "home"),
        "--shell",
        "/bin/bash",
        config.user,
      ])
    // Never change ownership of a supplied workspace or shared IDE installation.
    for (const name of ["config", "system", "log", "home", "run", "project", "screenshots"]) {
      await exec(["chown", "-R", config.user, join(config.dir, name)])
    }
  }
  await chmod(join(config.dir, "run"), 0o700)
  await Bun.write(join(config.dir, "config.json"), JSON.stringify(config, null, 2))
  console.log(
    `Installed IDEA ${product.version} and MCP Steroid ${config.steroid ?? "0.102"}${config.addon ? `, with Kilo ${config.kilo ?? "7.1.12"}` : ""} in ${config.dir}`,
  )
}

async function run(config: Config) {
  if (!(await Bun.file(join(config.dir, "config.json")).exists())) throw new Error("Run install first")
  if (await state(config.dir)) throw new Error("This sandbox is already running")
  if (await Bun.file(`/tmp/.X${config.display}-lock`).exists())
    throw new Error(`Display :${config.display} is in use; choose another --display`)
  for (const port of [config.port, config.vnc, config.mcp]) {
    const listener = Bun.listen({ hostname: "0.0.0.0", port, socket: { data() {} } })
    listener.stop(true)
  }
  const children: ReturnType<typeof Bun.spawn>[] = []
  const halt = Promise.withResolvers<void>()
  const stop = () => halt.resolve()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  const env = environment(config)
  const identity =
    process.getuid?.() === 0
      ? [
          "setpriv",
          "--reuid",
          config.user,
          "--regid",
          (await exec(["id", "-g", config.user], true)).trim(),
          "--init-groups",
          "--",
        ]
      : []
  const spawn = (cmd: string[]) => {
    const child = Bun.spawn([...identity, ...cmd], { env, cwd: config.project, stdout: "inherit", stderr: "inherit" })
    children.push(child)
    return child
  }
  let viewer: ReturnType<typeof desktop> | undefined
  try {
    await Bun.write(
      join(config.dir, "run.json"),
      JSON.stringify({ pid: process.pid, stamp: await stamp(process.pid), config }),
    )
    const display = spawn([
      "Xtigervnc",
      `:${config.display}`,
      "-geometry",
      "1600x1000",
      "-depth",
      "24",
      "-localhost",
      "yes",
      "-rfbport",
      String(config.vnc),
      "-SecurityTypes",
      "None",
      "-nolisten",
      "tcp",
      "-AlwaysShared",
      "-desktop",
      "IntelliJ Sandbox",
    ])
    const deadline = Date.now() + 15_000
    while (true) {
      if (display.exitCode != null) throw new Error(`Virtual display exited ${display.exitCode}`)
      const socket = await Bun.connect({ hostname: "127.0.0.1", port: config.vnc, socket: { data() {} } }).catch(
        (err) => {
          if (Date.now() >= deadline) throw err
          return undefined
        },
      )
      if (socket) {
        socket.end()
        break
      }
      await Bun.sleep(100)
    }
    spawn(["dbus-daemon", "--session", "--nofork", "--nopidfile", `--address=${env.DBUS_SESSION_BUS_ADDRESS}`])
    spawn(["openbox"])
    viewer = desktop({ host: config.host, port: config.port, vnc: config.vnc, origin: config.origin })
    const ide = spawn([join(config.ide, "bin/idea"), config.project])
    console.log(
      `Desktop ready at http://localhost:${config.port}/; IntelliJ is starting. MCP: http://127.0.0.1:${config.mcp}/mcp`,
    )
    await Promise.race([
      halt.promise,
      ...children.map((child) =>
        child.exited.then((code) => {
          if (child === ide && code === 0) return
          throw new Error(`Sandbox child ${child.pid} exited ${code}`)
        }),
      ),
    ])
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
    await viewer?.close()
    // Let IntelliJ finish saving before removing its window manager and display.
    for (const child of [...children].reverse()) {
      if (child.exitCode != null) continue
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000)
      await child.exited.finally(() => clearTimeout(timer))
    }
    await rm(join(config.dir, "run.json"), { force: true })
  }
}

async function main() {
  const initial = options(Bun.argv.slice(2))
  const file = Bun.file(join(initial.dir, "config.json"))
  const saved = (await file.exists()) ? ((await file.json()) as Record<string, unknown>) : {}
  const config = options(Bun.argv.slice(2), process.cwd(), saved)
  if (config.help || config.cmd === "help") {
    console.log(`Usage: bun .kilo/skills/jetbrains-sandbox/script/setup.ts <command> [options]

Commands:
  install       Install Debian 13 packages, pinned IDEA and plugins; no services started
  run           Run the desktop and IDE in the foreground; Ctrl+C stops its children
  stop          Request shutdown of this directory's verified supervisor
  status        Report the supervisor, viewer and local MCP endpoint
  mcp <tool> [json]  Call an MCP tool; use tools/list to discover tools
  screenshot    Capture the IDE (or --settings) through MCP
  serve         Serve only the captured PNG on a separate port

Options:
  --dir <path>       Isolated state (default .kilo-dev/jetbrains-sandbox)
  --ide <path>       Reuse an existing IDEA 2026.1 instead of downloading it
  --project <path>   Open an existing workspace; default is an empty isolated directory
  --host <address>   Default 127.0.0.1; use 0.0.0.0 behind secure sandbox forwarding
  --origin <url>     Explicit trusted preview origin if forwarding rewrites Host
  --port <number>    Viewer port 6080; screenshot server port 6083
  --display <n>      X display number (99); --vnc-port defaults 5999
  --mcp-port <n>     Local-only MCP port (6315)
  --user <name>     Non-root IDE user; root creates/reuses ideuser
  --with-kilo       Also install the optional signed Kilo 7.1.12 plugin
  --kilo-zip <path>  Enable Kilo using a trusted local plugin build
  --steroid-zip <path>  Override the pinned MCP Steroid archive
  --ca <path>       Trust a sandbox PEM CA (defaults NODE_EXTRA_CA_CERTS)
  --skip-deps       Skip apt; required tools must already be installed
  --settings        Open/capture Settings without changing settings or accepting dialogs
  --out <path>      Screenshot path (default <dir>/screenshot.png)

No public tunnel or viewer authentication is created. Only expose behind trusted forwarding.`)
    return
  }
  if (config.cmd === "install") return install(config)
  if (config.cmd === "run") return run(config)
  if (config.cmd === "stop") {
    const active = await state(config.dir)
    if (!active) {
      console.log("Sandbox is not running")
      return
    }
    process.kill(active.pid, "SIGTERM")
    const deadline = Date.now() + 35_000
    while ((await stamp(active.pid)) === active.stamp) {
      if (Date.now() >= deadline)
        throw new Error(`Supervisor ${active.pid} did not stop; inspect its tracked process logs`)
      await Bun.sleep(100)
    }
    console.log(`Stopped supervisor ${active.pid}`)
    return
  }
  if (config.cmd === "status") {
    const active = await state(config.dir)
    const viewer = await fetch(`http://127.0.0.1:${config.port}/`, { signal: AbortSignal.timeout(2000) })
      .then((res) => res.status)
      .catch((err) => String(err))
    const mcp = await fetch(`http://127.0.0.1:${config.mcp}/mcp`, { signal: AbortSignal.timeout(2000) })
      .then((res) => res.json())
      .catch((err) => String(err))
    console.log(JSON.stringify({ running: !!active, pid: active?.pid, viewer, mcp, dir: config.dir }, null, 2))
    return
  }
  if (config.cmd === "mcp" || config.cmd === "screenshot") {
    const client = await Client.connect(config.mcp)
    try {
      if (config.cmd === "screenshot") {
        await mkdir(resolve(config.out, ".."), { recursive: true })
        console.log(await capture(client, { out: config.out, settings: config.settings, project: config.target }))
        return
      }
      const name = config.args.at(0) ?? "steroid_list_projects"
      const params = JSON.parse(config.args.at(1) ?? "{}") as Record<string, unknown>
      const result = name === "tools/list" ? await client.request(name, params) : await client.tool(name, params)
      console.log(JSON.stringify(result, null, 2))
    } finally {
      await client.close()
    }
    return
  }
  if (config.cmd === "serve") {
    const image = Bun.file(config.out)
    if (
      !(await image.exists()) ||
      Buffer.from(await image.slice(0, 8).arrayBuffer()).toString("hex") !== "89504e470d0a1a0a"
    ) {
      throw new Error(`PNG screenshot not found: ${config.out}; run screenshot first`)
    }
    Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch(req) {
        if (!["/", "/screenshot.png"].includes(new URL(req.url).pathname))
          return new Response("Not found", { status: 404 })
        if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method denied", { status: 405 })
        return new Response(req.method === "HEAD" ? null : image, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
        })
      },
    })
    console.log(`Screenshot ready at http://localhost:${config.port}/`)
    return
  }
  throw new Error(`Unknown command: ${config.cmd}; use --help`)
}

if (import.meta.main) await main()
