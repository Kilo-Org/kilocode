import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { existsSync } from "node:fs"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import type { Entry } from "./contract-shape"
import { entries as readEntries, hash as readHash } from "./contract-shape"
import { UnavailableError } from "./backend"
import type { Backend, CallResult, ContentBlock } from "./backend"
import { BrowserContract } from "./contract"
import { INSTALL_HINT, locate } from "./locate"
import type { Target } from "./locate"
import type { Settings } from "./settings"

const log = Log.create({ service: "browser.playwright" })

const TIMEOUT = 180_000

function profile() {
  return path.join(Global.Path.data, "browser", "profile")
}

function output() {
  return path.join(Global.Path.data, "browser", "output")
}

/** The Chromium build of the bundled playwright-core, when it is installed. */
async function chromium() {
  const mod = await import("playwright-core")
  return mod.chromium.executablePath()
}

async function target(): Promise<Target> {
  const located = locate({
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    exists: existsSync,
    chromium: await chromium(),
  })
  if (!located) throw new UnavailableError(INSTALL_HINT, `No browser found. Install Chromium with ${INSTALL_HINT}`)
  return located
}

function blocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((item): ContentBlock[] => {
    if (typeof item !== "object" || item === null) return []
    if (!("type" in item)) return []
    if (item.type === "text" && "text" in item && typeof item.text === "string") return [{ type: "text", text: item.text }]
    if (item.type === "image" && "data" in item && typeof item.data === "string") {
      const mime = "mimeType" in item && typeof item.mimeType === "string" ? item.mimeType : "image/png"
      return [{ type: "image", data: item.data, mimeType: mime }]
    }
    return []
  })
}

type Connection = {
  client: Client
  server: Server
  tools: Entry[]
  sha: string
}

/**
 * The Playwright MCP package and its browser stack are loaded on the first browser call, not on CLI
 * start: together they add megabytes to a session that may never open a browser.
 */
async function connect(browser: Settings): Promise<Connection> {
  const dir = profile()
  const out = output()
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(out, { recursive: true })
  const located = await target()
  const mcp = await import("@playwright/mcp")
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")

  const server: Server = await mcp.createConnection({
    browser: {
      isolated: false,
      userDataDir: dir,
      launchOptions: { headless: false, ...located },
    },
    outputDir: out,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "kilo", version: BrowserContract.upstream })
  await client.connect(clientTransport)
  const listed = await client.listTools()
  const live = readEntries(listed)

  // The pinned hash covers the raw stdio tools/list JSON, which the client re-serializes. Compare
  // the normalized tool list instead: same tools, same schemas, same read-only hints.
  if (readHash(live) !== readHash(BrowserContract.entries)) {
    log.warn("bundled playwright MCP contract differs from the pinned contract", {
      expected: BrowserContract.sha256,
    })
  }
  // Keep the model-facing list identical to the vendored contract, on the tools this build has.
  const available = new Set(live.map((tool) => tool.name))
  const tools: Entry[] = BrowserContract.entries.filter((tool) => available.has(tool.name))

  return { client, server, tools, sha: BrowserContract.sha256 }
}

class PlaywrightBackend implements Backend {
  readonly id = "playwright" as const

  private constructor(
    private readonly conn: Connection,
    readonly contractSha: string,
    readonly tools: readonly Entry[],
  ) {}

  static async create(browser: Settings) {
    const conn = await connect(browser)
    return new PlaywrightBackend(conn, conn.sha, conn.tools)
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallResult> {
    const result = await this.conn.client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT })
    const content = blocks(result.content)
    const text = content.filter((block) => block.type === "text").map((block) => block.text)
    if (!content.length && result.structuredContent !== undefined) {
      content.push({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) })
    }
    return { content, isError: result.isError === true }
  }

  async dispose() {
    await this.conn.client.close()
    await this.conn.server.close()
  }
}

const cache = new Map<string, Promise<Backend>>()

/** One browser process per distinct Playwright configuration, shared by every session in the process. */
export function playwright(browser: Settings): Promise<Backend> {
  const key = JSON.stringify({ backend: browser.backend, target: browser.target })
  const existing = cache.get(key)
  if (existing) return existing
  const created = PlaywrightBackend.create(browser).then(
    (instance) => {
      cache.set(key, Promise.resolve(instance))
      return instance
    },
    (error) => {
      cache.delete(key)
      throw error
    },
  )
  cache.set(key, created)
  return created
}
