const vscode = require("vscode")
const http = require("node:http")
const path = require("node:path")

// This packaged helper only exposes a closed list of VS Code commands. It never
// creates a product webview, changes its bridge, or talks to the Kilo backend.
exports.activate = async (context) => {
  const root = process.env.RL_REAL_ROOT
  const inside = (value) => value && !path.relative(root, value).startsWith("..") && path.isAbsolute(value)
  if (!root || !inside(context.extensionPath) || !inside(context.globalStorageUri.fsPath))
    throw new Error("Real-host helper refused a non-isolated extension host")
  const keys = [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "GIT_CEILING_DIRECTORIES",
  ]
  if (keys.some((key) => !inside(process.env[key]))) throw new Error("Host environment escaped isolation")
  const commands = new Set([
    "kilo-code.SidebarProvider.focus",
    "kilo-code.new.focusChatInput",
    "kilo-code.new.agentManagerOpen",
    "kilo-code.new.settingsButtonClicked",
    "kilo-code.new.historyButtonClicked",
    "chatgpt.openSidebar",
    "workbench.action.reloadWindow",
  ])
  const status = () => ({
    pid: process.pid,
    vscode: vscode.version,
    storage: context.globalStorageUri.fsPath,
    env: Object.fromEntries(keys.map((key) => [key, process.env[key]])),
    extensions: vscode.extensions.all
      .filter((ext) => !ext.extensionPath.includes(`${path.sep}resources${path.sep}app${path.sep}extensions`))
      .map((ext) => ({
        id: ext.id,
        path: ext.extensionPath,
        active: ext.isActive,
        version: ext.packageJSON.version,
      })),
    settings: vscode.workspace.getConfiguration("kilo-code.new").get("chat.responseLens"),
  })
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${process.env.RL_RUN_CAP}`) {
        res.writeHead(403).end()
        return
      }
      const chunks = []
      for await (const chunk of req) {
        chunks.push(chunk)
        if (chunks.reduce((sum, item) => sum + item.length, 0) > 4096) throw new Error("Oversized helper request")
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
      if (body.activate) {
        if (!["kilocode.kilo-code", "openai.chatgpt"].includes(body.activate)) throw new Error("Activation not allowed")
        const ext = vscode.extensions.getExtension(body.activate)
        if (!ext || !inside(ext.extensionPath)) throw new Error("Package not in isolated extensions directory")
        await ext.activate()
      }
      if (body.command && !commands.has(body.command)) throw new Error("Command not allowed")
      if (body.command === "workbench.action.reloadWindow") {
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ reloading: true }))
        await vscode.commands.executeCommand(body.command)
        return
      }
      if (body.command) await vscode.commands.executeCommand(body.command)
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify(status()))
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error.message) }))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  context.subscriptions.push({
    dispose: () => {
      server.closeAllConnections()
      server.close()
    },
  })
  const payload = JSON.stringify({ ...status(), port: server.address().port })
  await new Promise((resolve, reject) => {
    const request = http.request(
      `${process.env.RL_CONTROL_URL}/host-ready`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RL_RUN_CAP}`, "Content-Type": "application/json" },
      },
      (response) => {
        response.resume()
        response.on("end", resolve)
      },
    )
    request.on("error", reject)
    request.end(payload)
  })
}
