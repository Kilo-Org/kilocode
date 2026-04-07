// kilocode_change start: shared symbol navigation used by KiloProvider and AgentManagerProvider
import * as vscode from "vscode"

/** Module-level cache — cleared when the VS Code window reloads. */
const symbolCache = new Map<string, { uri: vscode.Uri; index: number }>()

/**
 * Search the workspace for a symbol (class / method) by name and navigate to its definition.
 * Phase 1: LSP workspace symbol provider (requires an active language server).
 * Phase 2: File content search — same-name file first, then global scan.
 */
export async function openSymbol(rawSymbol: string): Promise<void> {
  const symbol = rawSymbol.replace(/\(\)$/, "").split(".").pop() ?? rawSymbol
  const isMethod = rawSymbol.endsWith("()")

  // Phase 1: LSP
  try {
    const results = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      symbol,
    )
    if (results && results.length > 0) {
      const exact = results.find((s) => s.name === symbol || s.name === rawSymbol.replace(/\(\)$/, ""))
      const target = exact ?? results[0]
      const doc = await vscode.workspace.openTextDocument(target.location.uri)
      await vscode.window.showTextDocument(doc, { selection: target.location.range, preview: false, preserveFocus: false })
      return
    }
  } catch { /* LSP unavailable */ }

  // Phase 2: content search
  const cached = symbolCache.get(rawSymbol)
  if (cached) {
    const doc = await vscode.workspace.openTextDocument(cached.uri)
    const pos = doc.positionAt(cached.index)
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: false, preserveFocus: false })
    return
  }

  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const exts = ["cs", "ts", "tsx", "js", "jsx", "mts", "py", "go", "rs", "cpp", "java", "kt", "swift"]
  type Hit = { uri: vscode.Uri; index: number }

  const searchWithPattern = async (pattern: RegExp): Promise<Hit | undefined> => {
    for (const ext of exts) {
      const uris = await vscode.workspace.findFiles(`**/*.${ext}`, "**/node_modules/**")
      for (const uri of uris) {
        if (!uri.fsPath.toLowerCase().endsWith(`.${ext}`)) continue
        try {
          const bytes = await vscode.workspace.fs.readFile(uri)
          const text = new TextDecoder().decode(bytes)
          const match = pattern.exec(text)
          if (match) return { uri, index: match.index }
        } catch { /* skip */ }
      }
    }
    return undefined
  }

  let hit: Hit | undefined

  if (isMethod) {
    const declPattern = new RegExp(
      `^[ \\t]*(?![ \\t]*//)(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|unsafe|partial|new|extern)[ \\t]+)+[^\\n]*\\b${esc}\\s*\\(`,
      "m",
    )
    hit = await searchWithPattern(declPattern)
    if (!hit) {
      hit = await searchWithPattern(
        new RegExp(`^[ \\t]*(?![ \\t]*//)(?![ \\t]*\\*)(?:[^\\n]*)\\b${esc}\\s*\\(`, "m"),
      )
    }
  } else {
    const declPattern = new RegExp(
      `^[ \\t]*(?![ \\t]*//)(?![ \\t]*\\*)(?:(?:public|private|protected|internal|static|abstract|sealed|partial)[ \\t]+)*(?:class|struct|interface|enum|record)[ \\t]+${esc}\\b`,
      "m",
    )
    const docExclude = "**/{node_modules,.ReadMe,.readme,docs,documentation,wiki,.doc}/**"
    for (const ext of exts) {
      const files = await vscode.workspace.findFiles(`**/${symbol}.${ext}`, docExclude, 5)
      for (const uri of files) {
        if (!uri.fsPath.toLowerCase().endsWith(`.${ext}`)) continue
        try {
          const bytes = await vscode.workspace.fs.readFile(uri)
          const text = new TextDecoder().decode(bytes)
          const match = declPattern.exec(text)
          if (match) { hit = { uri, index: match.index }; break }
        } catch { /* skip */ }
      }
      if (hit) break
    }
    if (!hit) hit = await searchWithPattern(declPattern)
  }

  if (hit) {
    const doc = await vscode.workspace.openTextDocument(hit.uri)
    const pos = doc.positionAt(hit.index)
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(pos, pos),
      preview: false,
      preserveFocus: false,
    })
    symbolCache.set(rawSymbol, hit)
    return
  }

  vscode.window.showInformationMessage(
    `Symbol not found: ${rawSymbol} (searched ${exts.map((e) => `*.${e}`).join(", ")})`,
  )
}
// kilocode_change end
