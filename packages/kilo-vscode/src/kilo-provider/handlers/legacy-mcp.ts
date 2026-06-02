import * as path from "path"
import * as vscode from "vscode"

interface LegacyMcpOptions {
  name: string
  workspace?: string
  storage?: vscode.Uri
}

/** Remove an MCP server from legacy files read by the CLI-side migrator. */
export async function removeLegacyMcp(opts: LegacyMcpOptions): Promise<boolean> {
  const files: vscode.Uri[] = []

  if (opts.workspace) {
    files.push(vscode.Uri.file(path.join(opts.workspace, ".kilo", "mcp.json")))
    files.push(vscode.Uri.file(path.join(opts.workspace, ".kilocode", "mcp.json")))
  }

  if (opts.storage) {
    files.push(vscode.Uri.joinPath(opts.storage, "settings", "mcp_settings.json"))
  }

  let removed = false
  for (const uri of files) {
    const bytes = await vscode.workspace.fs.readFile(uri).then(
      (data) => data,
      () => null,
    )
    if (!bytes) continue

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
      const servers = parsed.mcpServers as Record<string, unknown> | undefined
      if (!servers?.[opts.name]) continue

      delete servers[opts.name]
      const content = Buffer.from(JSON.stringify(parsed, null, 2), "utf8")
      await vscode.workspace.fs.writeFile(uri, content)
      removed = true
    } catch (err) {
      console.warn("[Kilo New] KiloProvider: Failed to remove legacy MCP from", uri.fsPath, err)
    }
  }

  return removed
}
