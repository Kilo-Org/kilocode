#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { spawn } from "node:child_process"
import { openSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import {
  delay,
  ensureStateDir,
  isAlive,
  logPath,
  output,
  ping,
  readState,
  removeState,
  request,
  root,
} from "./common.mjs"

function fail(message) {
  throw new Error(message)
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

function result(value) {
  const text = value.text ? [{ type: "text", text: value.text }] : []
  const images = (value.images ?? []).map((item) => ({
    type: "image",
    data: Buffer.from(readFileSync(item.path)).toString("base64"),
    mimeType: item.mimeType,
  }))
  const content = [...text, ...images]

  if (!value.structuredContent) {
    return { content }
  }

  return {
    content,
    structuredContent: value.structuredContent,
  }
}

async function call(name, input) {
  const current = await daemon(true)
  const value = await request(current.state, "/tool", { arguments: input, name })
  return result(value)
}

const server = new McpServer({
  name: "kilo-vscode-self-test",
  version: "1.0.0",
})

server.registerTool(
  "daemon-status",
  {
    description: "Show the status of the per-worktree VS Code self-test daemon.",
    inputSchema: {},
  },
  async () => {
    const current = await daemon(false)

    return {
      content: [
        {
          type: "text",
          text: current ? "Self-test daemon is running." : "Self-test daemon is not running.",
        },
      ],
      structuredContent: current?.info ?? { running: false },
    }
  },
)

server.registerTool(
  "stop-daemon",
  {
    description: "Stop the per-worktree self-test daemon and any owned VS Code instance.",
    inputSchema: {},
  },
  async () => {
    const current = await daemon(false)
    if (!current) {
      return {
        content: [{ type: "text", text: "Self-test daemon is already stopped." }],
        structuredContent: { stopped: false },
      }
    }

    await request(current.state, "/stop", {})
    return {
      content: [{ type: "text", text: "Stopping self-test daemon." }],
      structuredContent: { stopping: true },
    }
  },
)

const tools = [
  [
    "launch-vscode",
    "Build the extension, install or load it into an isolated VS Code instance, and launch it for manual testing.",
    {
      appPath: z.string().optional(),
      build: z.boolean().optional(),
      mode: z.enum(["dev", "vsix"]).optional(),
      waitMs: z.number().int().positive().max(60000).optional(),
      workspace: z.string().optional(),
    },
  ],
  [
    "vscode-state",
    "Show the current isolated VS Code session details and a text snapshot of the active window.",
    { maxChars: z.number().int().positive().max(20000).optional() },
  ],
  ["vscode-frames", "List the active Playwright frames in the VS Code window.", {}],
  [
    "vscode-snapshot",
    "Capture the visible text content from the VS Code window or a matching frame.",
    { frame: z.string().optional(), maxChars: z.number().int().positive().max(50000).optional() },
  ],
  [
    "vscode-screenshot",
    "Capture a screenshot of the VS Code window or a matching element.",
    {
      frame: z.string().optional(),
      fullPage: z.boolean().optional(),
      path: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
    },
  ],
  [
    "vscode-observe",
    "Capture a screenshot and text snapshot together for an observe-action loop.",
    {
      frame: z.string().optional(),
      fullPage: z.boolean().optional(),
      maxChars: z.number().int().positive().max(50000).optional(),
      path: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
    },
  ],
  ["open-kilo", "Focus the Kilo sidebar view in VS Code.", { waitMs: z.number().int().min(0).max(60000).optional() }],
  [
    "open-agent-manager",
    "Open the Agent Manager from the Kilo sidebar toolbar button.",
    { waitMs: z.number().int().min(0).max(60000).optional() },
  ],
  [
    "open-kilo-settings",
    "Open the Kilo settings panel from the Kilo sidebar toolbar button.",
    { waitMs: z.number().int().min(0).max(60000).optional() },
  ],
  [
    "vscode-click",
    "Click a VS Code element by selector or visible text, or click absolute window coordinates.",
    {
      button: z.enum(["left", "middle", "right"]).optional(),
      exact: z.boolean().optional(),
      frame: z.string().optional(),
      nth: z.number().int().min(0).optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      waitMs: z.number().int().min(0).max(60000).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    },
  ],
  [
    "vscode-move",
    "Move the mouse to absolute window coordinates.",
    {
      steps: z.number().int().positive().max(200).optional(),
      waitMs: z.number().int().min(0).max(60000).optional(),
      x: z.number(),
      y: z.number(),
    },
  ],
  [
    "vscode-scroll",
    "Scroll the VS Code window using mouse wheel deltas.",
    {
      deltaX: z.number().optional(),
      deltaY: z.number().optional(),
      waitMs: z.number().int().min(0).max(60000).optional(),
    },
  ],
  [
    "vscode-evaluate",
    "Run JavaScript in the current VS Code page or a matching frame and return a JSON-serializable result.",
    { frame: z.string().optional(), maxChars: z.number().int().positive().max(50000).optional(), script: z.string() },
  ],
  [
    "vscode-type",
    "Type text into the current VS Code focus target or an element selected by selector or text.",
    {
      clear: z.boolean().optional(),
      exact: z.boolean().optional(),
      frame: z.string().optional(),
      nth: z.number().int().min(0).optional(),
      selector: z.string().optional(),
      submit: z.boolean().optional(),
      text: z.string().optional(),
      value: z.string(),
      waitMs: z.number().int().min(0).max(60000).optional(),
    },
  ],
  [
    "vscode-press",
    "Send a keyboard shortcut to the VS Code window.",
    { keys: z.string(), waitMs: z.number().int().min(0).max(60000).optional() },
  ],
  [
    "vscode-run-command",
    "Open the command palette, search for a command, and execute it.",
    { command: z.string(), waitMs: z.number().int().min(0).max(60000).optional() },
  ],
  [
    "vscode-wait",
    "Wait for a VS Code element or visible text to reach a given state.",
    {
      exact: z.boolean().optional(),
      frame: z.string().optional(),
      nth: z.number().int().min(0).optional(),
      selector: z.string().optional(),
      state: z.enum(["attached", "detached", "hidden", "visible"]).optional(),
      text: z.string().optional(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  ],
  [
    "vscode-logs",
    "Read the newest VS Code log files from the isolated user-data directory.",
    {
      filter: z.string().optional(),
      limit: z.number().int().positive().max(200).optional(),
      maxChars: z.number().int().positive().max(50000).optional(),
    },
  ],
  [
    "vscode-console",
    "Read recent browser and webview console messages captured from the live VS Code window.",
    {
      limit: z.number().int().positive().max(200).optional(),
      maxChars: z.number().int().positive().max(50000).optional(),
      type: z.string().optional(),
    },
  ],
  [
    "stop-vscode",
    "Close the isolated VS Code session and optionally remove its temp directories.",
    { cleanup: z.boolean().optional() },
  ],
]

for (const [name, description, inputSchema] of tools) {
  server.registerTool(name, { description, inputSchema }, async (input) => call(name, input))
}

if (process.argv.includes("--self-check")) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [import.meta.filename],
    cwd: root,
    stderr: "inherit",
  })
  const client = new Client({ name: "self-check", version: "1.0.0" })
  await client.connect(transport)
  const tools = await client.listTools()
  output(tools.tools.map((item) => item.name))
  await client.close()
  process.exit(0)
}

const transport = new StdioServerTransport()
await server.connect(transport)
