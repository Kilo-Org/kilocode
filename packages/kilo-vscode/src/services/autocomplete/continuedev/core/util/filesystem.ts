import * as fs from "node:fs"

import { fileURLToPath } from "node:url"
import type { IDE, Location, Range, RangeInFile, SignatureHelp } from "../index.js"

class FileSystemIde implements IDE {
  constructor(private readonly workspaceDir: string) {}

  gotoDefinition(_location: Location): Promise<RangeInFile[]> {
    return Promise.resolve([])
  }

  gotoTypeDefinition(_location: Location): Promise<RangeInFile[]> {
    return Promise.resolve([])
  }

  getSignatureHelp(_location: Location): Promise<SignatureHelp | null> {
    return Promise.resolve(null)
  }

  onDidChangeActiveTextEditor(_callback: (fileUri: string) => void): void {
    return
  }

  readRangeInFile(_fileUri: string, _range: Range): Promise<string> {
    return Promise.resolve("")
  }

  getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    return Promise.resolve({ text: "", copiedAt: new Date().toISOString() })
  }
  getWorkspaceDirs(): Promise<string[]> {
    return Promise.resolve([this.workspaceDir])
  }

  readFile(fileUri: string): Promise<string> {
    const filepath = fileURLToPath(fileUri)
    return new Promise((resolve, reject) => {
      fs.readFile(filepath, "utf8", (err, contents) => {
        if (err) {
          reject(err)
        }
        resolve(contents)
      })
    })
  }
}

export { FileSystemIde }
