import * as vscode from "vscode"
import * as URI from "uri-js"
import type { IDE, Location, Range, RangeInFile, SignatureHelp } from "../.."
import { executeGotoProvider, executeSignatureHelpProvider } from "./autocomplete/lsp"

async function stat(uri: vscode.Uri): Promise<vscode.FileStat | null> {
  try {
    return await vscode.workspace.fs.stat(uri)
  } catch {
    return null
  }
}

function areEqualURIs(uri1: vscode.Uri, uri2: vscode.Uri): boolean {
  return URI.equal(uri1.toString(), uri2.toString())
}

async function readFile(uri: vscode.Uri): Promise<Uint8Array | null> {
  const openDocuments = vscode.workspace.textDocuments
  for (const document of openDocuments) {
    if (areEqualURIs(document.uri, uri)) {
      // Found an open document with this URI.
      // Return its current content (including any unsaved changes) as Uint8Array.
      const docText = document.getText()
      return new Uint8Array(Buffer.from(docText, "utf8"))
    }
  }

  try {
    return await vscode.workspace.fs.readFile(uri)
  } catch {
    return null
  }
}

export class VsCodeIde implements IDE {
  private static MAX_BYTES = 100000
  constructor(_context: vscode.ExtensionContext) {}

  async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    return {
      text: await vscode.env.clipboard.readText(),
      copiedAt: new Date().toISOString(),
    }
  }

  private _workspaceDirectories: vscode.Uri[] | undefined = undefined
  async getWorkspaceDirs(): Promise<string[]> {
    if (!this._workspaceDirectories) {
      this._workspaceDirectories = vscode.workspace.workspaceFolders?.map((folder) => folder.uri)
    }
    return this._workspaceDirectories?.map((uri) => uri.toString()) ?? []
  }

  async readFile(fileUri: string): Promise<string> {
    try {
      const uri = vscode.Uri.parse(fileUri)

      // First, check whether it's a notebook document
      // Need to iterate over the cells to get full contents
      const notebook =
        vscode.workspace.notebookDocuments.find((doc) => URI.equal(doc.uri.toString(), uri.toString())) ??
        (uri.path.endsWith("ipynb") ? await vscode.workspace.openNotebookDocument(uri) : undefined)
      if (notebook) {
        return notebook
          .getCells()
          .map((cell) => cell.document.getText())
          .join("\n\n")
      }

      // Check whether it's an open document
      const openTextDocument = vscode.workspace.textDocuments.find((doc) =>
        URI.equal(doc.uri.toString(), uri.toString()),
      )
      if (openTextDocument !== undefined) {
        return openTextDocument.getText()
      }

      const fileStats = await stat(uri)
      if (fileStats === null || fileStats.size > 10 * VsCodeIde.MAX_BYTES) {
        return ""
      }

      const bytes = await readFile(uri)
      if (bytes === null) {
        return ""
      }

      // Truncate the buffer to the first MAX_BYTES
      const truncatedBytes = bytes.slice(0, VsCodeIde.MAX_BYTES)
      const contents = new TextDecoder().decode(truncatedBytes)
      return contents
    } catch (e) {
      return ""
    }
  }

  async readRangeInFile(fileUri: string, range: Range): Promise<string> {
    const buffer = await readFile(vscode.Uri.parse(fileUri))
    if (buffer === null) {
      return ""
    }
    const contents = new TextDecoder().decode(buffer)
    const lines = contents.split("\n")
    return `${lines.slice(range.start.line, range.end.line).join("\n")}\n${lines[
      range.end.line < lines.length - 1 ? range.end.line : lines.length - 1
    ].slice(0, range.end.character)}`
  }

  async gotoDefinition(location: Location): Promise<RangeInFile[]> {
    const result = await executeGotoProvider({
      uri: vscode.Uri.parse(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeDefinitionProvider",
    })

    return result
  }

  async gotoTypeDefinition(location: Location): Promise<RangeInFile[]> {
    const result = await executeGotoProvider({
      uri: vscode.Uri.parse(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeTypeDefinitionProvider",
    })

    return result
  }

  async getSignatureHelp(location: Location): Promise<SignatureHelp | null> {
    const result = await executeSignatureHelpProvider({
      uri: vscode.Uri.parse(location.filepath),
      line: location.position.line,
      character: location.position.character,
      name: "vscode.executeSignatureHelpProvider",
    })

    return result
  }

  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): vscode.Disposable {
    return vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        callback(editor.document.uri.toString())
      }
    })
  }
}
