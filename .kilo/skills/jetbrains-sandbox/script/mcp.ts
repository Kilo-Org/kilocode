import { resolve } from "node:path"

const HOST = "127.0.0.1"
const PROTOCOL = "2025-11-25"
const TIMEOUT = 180_000
const TASK = "jetbrains-sandbox"
const SETTINGS_WAIT = 20_000

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string } }

type Call = { content: Content[]; isError?: boolean }

type Reply = { result?: unknown; error?: { code: number; message: string } }
type Json = Record<string, unknown>
type Project = { project_name: string; name: string; path: string }
type Win = {
  windowId: string
  project_name?: string | null
  title?: string | null
  isVisible?: boolean
  isActive?: boolean
  modalDialogShowing?: boolean
}

export class Client {
  private url: string
  private session = ""
  private id = 0
  private closed = false

  private constructor(port: number) {
    this.url = `http://${HOST}:${port}/mcp`
  }

  static async connect(port: number): Promise<Client> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid MCP port: ${port}`)
    const client = new Client(port)
    try {
      const result = (await client.rpc("initialize", {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "kilo-jetbrains-sandbox", version: "1.0.0" },
      })) as { protocolVersion?: string }
      if (result?.protocolVersion !== PROTOCOL) {
        throw new Error(`MCP protocol mismatch: expected ${PROTOCOL}, got ${result?.protocolVersion ?? "none"}`)
      }
      await client.rpc("notifications/initialized", undefined, true)
      return client
    } catch (err) {
      await client.close().catch((cleanup) => console.error("MCP session cleanup after failed connect", cleanup))
      throw err
    }
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.rpc(method, params)
  }

  async tool(name: string, args: Record<string, unknown> = {}): Promise<Call> {
    const result = (await this.rpc("tools/call", { name, arguments: args })) as Call
    if (!result || !Array.isArray(result.content)) throw new Error(`MCP tool ${name} returned an invalid result`)
    if (result.isError) throw new Error(`MCP tool ${name} failed: ${text(result) || "no details"}`)
    return result
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (!this.session) return
    const session = this.session
    this.session = ""
    const res = await fetch(this.url, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": session },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok && res.status !== 404) throw new Error(`MCP session cleanup HTTP ${res.status}: ${await res.text()}`)
  }

  private async rpc(method: string, params?: Record<string, unknown>, note = false): Promise<unknown> {
    if (this.closed) throw new Error("MCP client is closed")
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL,
    })
    if (this.session) headers.set("Mcp-Session-Id", this.session)
    const body: Json = { jsonrpc: "2.0" }
    if (!note) body.id = ++this.id
    body.method = method
    if (params) body.params = params
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const session = res.headers.get("Mcp-Session-Id")
    if (session) this.session = session
    const raw = await res.text()
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${raw || res.statusText}`)
    if (note || res.status === 202 || res.status === 204 || raw === "") return undefined
    const reply = JSON.parse(raw) as Reply
    if (reply.error) throw new Error(`MCP ${reply.error.code}: ${reply.error.message}`)
    return reply.result
  }
}

export async function capture(
  client: Client,
  opts: { out: string; settings?: boolean; project?: string },
): Promise<string> {
  const projects = parse<{ projects?: Project[] }>(await client.tool("steroid_list_projects"), "steroid_list_projects")
  const key = select(projects.projects ?? [], opts.project).project_name
  let windows = await list(client)

  if (!opts.settings) {
    const visible = windows.filter((win) => win.project_name === key && win.isVisible !== false)
    const target = visible.find((win) => win.isActive) ?? one(visible)
    if (!target) {
      throw new Error(
        visible.length === 0
          ? `No visible window for project ${key}; open it and retry.`
          : `Multiple visible windows for project ${key}; activate the intended window and retry.`,
      )
    }
    return shot(client, key, target, opts.out)
  }

  let dialog = settingsWindow(windows)
  if (!dialog) {
    const modal = windows.find((win) => win.isVisible !== false && win.modalDialogShowing && !isSettings(win))
    if (modal) {
      throw new Error(
        `Cannot open Settings: an unrelated modal is active (${modal.title?.trim() || modal.windowId}). Close it manually and retry; jetbrains-sandbox does not dismiss unrelated dialogs.`,
      )
    }
    await openSettings(client, key)
    const deadline = Date.now() + SETTINGS_WAIT
    while (!dialog) {
      if (Date.now() > deadline) {
        throw new Error(
          `Settings window did not appear within ${SETTINGS_WAIT / 1000}s. Check the IDE for a blocking modal and retry.`,
        )
      }
      await Bun.sleep(250)
      windows = await list(client)
      dialog = settingsWindow(windows)
    }
  }
  return shot(client, key, dialog, opts.out)
}

function text(call: Call): string {
  return call.content
    .filter((part): part is Extract<Content, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function parse<T>(call: Call, name: string): T {
  const raw = text(call)
  if (!raw) throw new Error(`MCP tool ${name} returned no text`)
  return JSON.parse(raw) as T
}

function one<T>(items: T[]): T | undefined {
  return items.length === 1 ? items.at(0) : undefined
}

function select(projects: Project[], wanted?: string): Project {
  if (wanted == null) {
    const only = one(projects)
    if (only) return only
    throw new Error(
      projects.length === 0
        ? "No IntelliJ projects are open; open one and retry."
        : `Multiple IntelliJ projects are open; pass opts.project. Available: ${projects.map((item) => item.project_name).join(", ")}`,
    )
  }
  const norm = (value: string) => value.replace(/[\\/]+$/, "")
  const matches = projects.filter(
    (item) =>
      item.project_name === wanted ||
      item.name === wanted ||
      norm(item.path) === norm(wanted) ||
      norm(item.path) === norm(resolve(wanted)),
  )
  const only = one(matches)
  if (only) return only
  if (matches.length === 0) {
    throw new Error(
      `Project "${wanted}" not found. Available: ${projects.map((item) => `${item.name} (${item.project_name})`).join(", ") || "none"}`,
    )
  }
  throw new Error(
    `Project "${wanted}" is ambiguous; matches: ${matches.map((item) => item.project_name).join(", ")}. Pass the project_name routing key.`,
  )
}

function isSettings(win: Win): boolean {
  return win.isVisible !== false && /^(settings|preferences)\b/i.test((win.title ?? "").trim())
}

function settingsWindow(windows: Win[]): Win | undefined {
  return windows.find(isSettings)
}

async function list(client: Client): Promise<Win[]> {
  const result = parse<{ windows?: Win[] }>(await client.tool("steroid_list_windows"), "steroid_list_windows")
  return result.windows ?? []
}

async function openSettings(client: Client, key: string): Promise<void> {
  const code = [
    "import com.intellij.openapi.application.ApplicationManager",
    "import com.intellij.openapi.options.ShowSettingsUtil",
    'ApplicationManager.getApplication().invokeLater { ShowSettingsUtil.getInstance().showSettingsDialog(project, "Appearance") }',
    'println("Requested Settings dialog (Appearance)")',
  ].join("\n")
  const result = await client.tool("steroid_execute_code", {
    project_name: key,
    code,
    task_id: TASK,
    reason: "Open IntelliJ Settings on the Appearance page so the sandbox skill can capture it.",
    modal: "unleashed",
    timeout: 30,
  })
  const output = text(result)
  if (!output.includes("Requested Settings dialog (Appearance)")) {
    throw new Error(`Settings command did not report success: ${output || "no output"}`)
  }
}

async function shot(client: Client, key: string, win: Win, out: string): Promise<string> {
  const label = win.title?.trim() || win.windowId
  const call = await client.tool("steroid_take_screenshot", {
    project_name: key,
    task_id: TASK,
    reason: `Capture the ${label} window for the jetbrains-sandbox skill.`,
    window_id: win.windowId,
  })
  const image = call.content.find(
    (part): part is Extract<Content, { type: "image" }> =>
      part.type === "image" && part.mimeType === "image/png" && part.data.length > 0,
  )
  if (!image) throw new Error(`MCP screenshot returned no PNG image: ${text(call) || "empty content"}`)
  await Bun.write(out, Buffer.from(image.data, "base64"))
  return out
}
