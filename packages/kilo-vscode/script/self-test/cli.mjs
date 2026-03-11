#!/usr/bin/env node
import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  delay,
  ensureStateDir,
  isAlive,
  logPath,
  output,
  ping,
  readState,
  removeState,
  repo,
  request,
  root,
} from "./common.mjs"

function fail(message) {
  throw new Error(message)
}

function parse(argv) {
  const result = { _: [] }

  for (let index = 0; index < argv.length; index++) {
    const item = argv[index]
    if (!item.startsWith("--")) {
      result._.push(item)
      continue
    }

    if (item.startsWith("--no-")) {
      result[item.slice(5)] = false
      continue
    }

    const [key, raw] = item.slice(2).split("=", 2)
    if (raw !== undefined) {
      result[key] = raw
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      result[key] = true
      continue
    }

    result[key] = next
    index++
  }

  return result
}

function bool(options, key, fallback) {
  const value = options[key]
  if (value === undefined) {
    return fallback
  }

  if (typeof value === "boolean") {
    return value
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  return Boolean(value)
}

function num(options, key, fallback) {
  const value = options[key]
  if (value === undefined) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fail(`Invalid number for --${key}: ${value}`)
  }

  return parsed
}

function str(options, key, fallback) {
  return options[key] ?? fallback
}

function filepath(options, key) {
  const value = options[key]
  if (!value) {
    return undefined
  }

  return resolve(process.cwd(), value)
}

async function active(timeoutMs = 0) {
  const state = readState()
  if (!state) {
    return null
  }

  const started = Date.now()
  while (Date.now() - started <= timeoutMs) {
    const info = await ping(state)
    if (info) {
      return { info, state }
    }

    await delay(200)
  }

  const info = await ping(state)
  if (info) {
    return { info, state }
  }

  if (!isAlive(state.pid)) {
    removeState()
    return null
  }

  return null
}

async function start() {
  const found = await active(500)
  if (found) {
    return found
  }

  ensureStateDir()
  const fd = openSync(logPath, "a")
  const child = spawn(process.execPath, [join(root, "script", "self-test", "daemon.mjs")], {
    cwd: root,
    detached: true,
    stdio: ["ignore", fd, fd],
  })
  child.unref()

  const started = Date.now()
  while (Date.now() - started <= 10000) {
    const next = await active(500)
    if (next) {
      return next
    }

    await delay(200)
  }

  return fail(`Timed out waiting for self-test daemon. Check ${logPath}`)
}

async function daemon(required = true) {
  const found = await active(500)
  if (found || !required) {
    return found
  }

  return start()
}

async function tool(name, input) {
  const current = await daemon(true)
  const result = await request(current.state, "/tool", { arguments: input, name })
  output(result)
}

function help() {
  process.stdout.write(`vscode-self-test commands:

  start
  stop
  status
  launch-vscode [--mode dev|vsix] [--build true|false] [--workspace PATH]
  stop-vscode [--cleanup true|false]
  state [--max-chars N]
  frames
  observe [--path FILE] [--frame MATCH] [--selector CSS] [--text TEXT]
  screenshot [--path FILE] [--frame MATCH] [--selector CSS] [--text TEXT]
  click [--selector CSS | --text TEXT | --x N --y N] [--frame MATCH]
  move --x N --y N [--steps N]
  scroll [--delta-x N] [--delta-y N]
  type --value TEXT [--selector CSS | --text TEXT]
  press --keys SHORTCUT
  wait [--selector CSS | --text TEXT] [--state visible|hidden|attached|detached]
  run-command --command TEXT
  open-kilo
  open-agent-manager
  open-kilo-settings
  logs
  console
  evaluate --script JS [--frame MATCH]
`)
}

const command = process.argv[2]
const options = parse(process.argv.slice(3))

if (!command || command === "help" || command === "--help") {
  help()
  process.exit(0)
}

if (command === "start") {
  const current = await start()
  output(current.info)
  process.exit(0)
}

if (command === "stop") {
  const current = await daemon(false)
  if (!current) {
    output({ stopped: false })
    process.exit(0)
  }

  await request(current.state, "/stop", {})
  const started = Date.now()
  while (Date.now() - started <= 5000) {
    const next = await daemon(false)
    if (!next) {
      output({ stopped: true })
      process.exit(0)
    }

    await delay(200)
  }

  if (!isAlive(current.state.pid)) {
    removeState()
    output({ stopped: true, forced: true })
    process.exit(0)
  }

  fail(`Timed out stopping self-test daemon ${current.state.pid}`)
}

if (command === "status") {
  const current = await daemon(false)
  output(current?.info ?? { running: false })
  process.exit(0)
}

if (command === "launch-vscode" || command === "restart-vscode") {
  await tool("launch-vscode", {
    appPath: str(options, "app-path", undefined),
    build: bool(options, "build", true),
    mode: str(options, "mode", "dev"),
    waitMs: num(options, "wait-ms", 3000),
    workspace: resolve(str(options, "workspace", repo)),
  })
  process.exit(0)
}

if (command === "stop-vscode") {
  await tool("stop-vscode", {
    cleanup: bool(options, "cleanup", true),
  })
  process.exit(0)
}

if (command === "state") {
  await tool("vscode-state", {
    maxChars: num(options, "max-chars", 4000),
  })
  process.exit(0)
}

if (command === "frames") {
  await tool("vscode-frames", {})
  process.exit(0)
}

if (command === "snapshot") {
  await tool("vscode-snapshot", {
    frame: str(options, "frame", undefined),
    maxChars: num(options, "max-chars", 4000),
  })
  process.exit(0)
}

if (command === "screenshot") {
  await tool("vscode-screenshot", {
    frame: str(options, "frame", undefined),
    fullPage: bool(options, "full-page", true),
    path: filepath(options, "path"),
    selector: str(options, "selector", undefined),
    text: str(options, "text", undefined),
  })
  process.exit(0)
}

if (command === "observe") {
  await tool("vscode-observe", {
    frame: str(options, "frame", undefined),
    fullPage: bool(options, "full-page", true),
    maxChars: num(options, "max-chars", 4000),
    path: filepath(options, "path"),
    selector: str(options, "selector", undefined),
    text: str(options, "text", undefined),
  })
  process.exit(0)
}

if (command === "click") {
  await tool("vscode-click", {
    button: str(options, "button", undefined),
    exact: bool(options, "exact", undefined),
    frame: str(options, "frame", undefined),
    nth: num(options, "nth", undefined),
    selector: str(options, "selector", undefined),
    text: str(options, "text", undefined),
    waitMs: num(options, "wait-ms", 500),
    x: num(options, "x", undefined),
    y: num(options, "y", undefined),
  })
  process.exit(0)
}

if (command === "move") {
  await tool("vscode-move", {
    steps: num(options, "steps", 1),
    waitMs: num(options, "wait-ms", 100),
    x: num(options, "x", undefined),
    y: num(options, "y", undefined),
  })
  process.exit(0)
}

if (command === "scroll") {
  await tool("vscode-scroll", {
    deltaX: num(options, "delta-x", 0),
    deltaY: num(options, "delta-y", 0),
    waitMs: num(options, "wait-ms", 250),
  })
  process.exit(0)
}

if (command === "type") {
  await tool("vscode-type", {
    clear: bool(options, "clear", false),
    exact: bool(options, "exact", undefined),
    frame: str(options, "frame", undefined),
    nth: num(options, "nth", undefined),
    selector: str(options, "selector", undefined),
    submit: bool(options, "submit", false),
    text: str(options, "text", undefined),
    value: str(options, "value", undefined) ?? fail("Missing --value"),
    waitMs: num(options, "wait-ms", 500),
  })
  process.exit(0)
}

if (command === "press") {
  await tool("vscode-press", {
    keys: str(options, "keys", options._[0]) ?? fail("Missing --keys"),
    waitMs: num(options, "wait-ms", 500),
  })
  process.exit(0)
}

if (command === "wait") {
  await tool("vscode-wait", {
    exact: bool(options, "exact", undefined),
    frame: str(options, "frame", undefined),
    nth: num(options, "nth", undefined),
    selector: str(options, "selector", undefined),
    state: str(options, "state", undefined),
    text: str(options, "text", undefined),
    timeoutMs: num(options, "timeout-ms", 10000),
  })
  process.exit(0)
}

if (command === "run-command") {
  await tool("vscode-run-command", {
    command: str(options, "command", options._[0]) ?? fail("Missing --command"),
    waitMs: num(options, "wait-ms", 1000),
  })
  process.exit(0)
}

if (command === "open-kilo" || command === "open-kilo-sidebar") {
  await tool("open-kilo", {
    waitMs: num(options, "wait-ms", 1500),
  })
  process.exit(0)
}

if (command === "open-agent-manager") {
  await tool("open-agent-manager", {
    waitMs: num(options, "wait-ms", 2500),
  })
  process.exit(0)
}

if (command === "open-kilo-settings") {
  await tool("open-kilo-settings", {
    waitMs: num(options, "wait-ms", 2500),
  })
  process.exit(0)
}

if (command === "logs") {
  await tool("vscode-logs", {
    filter: str(options, "filter", undefined),
    limit: num(options, "limit", 40),
    maxChars: num(options, "max-chars", 12000),
  })
  process.exit(0)
}

if (command === "console") {
  await tool("vscode-console", {
    limit: num(options, "limit", 50),
    maxChars: num(options, "max-chars", 4000),
    type: str(options, "type", undefined),
  })
  process.exit(0)
}

if (command === "evaluate") {
  await tool("vscode-evaluate", {
    frame: str(options, "frame", undefined),
    maxChars: num(options, "max-chars", 4000),
    script: str(options, "script", undefined) ?? fail("Missing --script"),
  })
  process.exit(0)
}

help()
process.exit(1)
