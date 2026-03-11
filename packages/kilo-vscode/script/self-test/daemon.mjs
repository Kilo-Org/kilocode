#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { createServer } from "node:http"
import { join } from "node:path"
import { logPath, output, removeState, repo, root, statePath, token, writeState } from "./common.mjs"

const auth = token()
const state = {
  closing: false,
  port: 0,
  session: null,
  startedAt: new Date().toISOString(),
  tools: [],
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "script", "self-test", "engine-mcp.mjs")],
  cwd: root,
  stderr: "inherit",
})

const client = new Client({
  name: "vscode-self-test-daemon",
  version: "1.0.0",
})

function payload(result) {
  const text = result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")

  const images = result.content
    ?.filter((item) => item.type === "image")
    .map((item) => ({
      mimeType: item.mimeType,
      path: result.structuredContent?.path ?? null,
      type: item.type,
    }))

  return {
    images: images ?? [],
    isError: result.isError ?? false,
    structuredContent: result.structuredContent ?? null,
    text: text?.trim() || null,
  }
}

function snapshot() {
  return {
    logPath,
    pid: process.pid,
    port: state.port,
    repo,
    session: state.session,
    startedAt: state.startedAt,
    statePath,
    tools: state.tools,
  }
}

function persist() {
  writeState({
    logPath,
    pid: process.pid,
    port: state.port,
    repo,
    startedAt: state.startedAt,
    statePath,
    token: auth,
  })
}

function json(res, code, value) {
  res.writeHead(code, { "content-type": "application/json" })
  res.end(JSON.stringify(value, null, 2))
}

function unauthorized(req, res) {
  if (req.headers["x-kilo-self-test-token"] === auth) {
    return false
  }

  json(res, 401, { error: "Unauthorized" })
  return true
}

async function body(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function invoke(name, input) {
  const result = await client.callTool({
    name,
    arguments: input ?? {},
  })

  const current = result.structuredContent ?? null

  if (name === "launch-vscode") {
    state.session = current
  }

  if (name === "stop-vscode") {
    state.session = null
  }

  if (name !== "launch-vscode" && name !== "stop-vscode" && state.session && current && typeof current === "object") {
    state.session = {
      ...state.session,
      ...current,
    }
  }

  return payload(result)
}

async function shutdown() {
  if (state.closing) {
    return
  }

  state.closing = true
  removeState()
  await invoke("stop-vscode", { cleanup: true }).catch(() => undefined)
  await client.close().catch(() => undefined)
  await new Promise((resolve) => server.close(resolve))
  process.exit(0)
}

const server = createServer(async (req, res) => {
  try {
    if (unauthorized(req, res)) {
      return
    }

    if (req.method === "GET" && req.url === "/status") {
      json(res, 200, snapshot())
      return
    }

    if (req.method === "POST" && req.url === "/stop") {
      json(res, 200, { stopping: true })
      setTimeout(() => {
        void shutdown()
      }, 50)
      return
    }

    if (req.method === "POST" && req.url === "/tool") {
      const input = await body(req)
      const result = await invoke(input.name, input.arguments)
      json(res, 200, result)
      return
    }

    json(res, 404, { error: "Not found" })
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

await client.connect(transport)
const tools = await client.listTools()
state.tools = tools.tools.map((item) => item.name)

await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    state.port = typeof address === "object" && address ? address.port : 0
    persist()
    output({ started: true, ...snapshot() })
    resolve(undefined)
  })
})

process.on("SIGINT", () => {
  void shutdown()
})

process.on("SIGTERM", () => {
  void shutdown()
})
