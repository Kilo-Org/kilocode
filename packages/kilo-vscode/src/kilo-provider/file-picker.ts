import * as vscode from "vscode"

type Input = {
  requestId: string
  post: (message: unknown) => void
}

export async function handleFilePicker(input: Input): Promise<void> {
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "Select file",
  })
  input.post({
    type: "filePickerResult",
    path: uri && uri[0] ? uri[0].fsPath : "",
    requestId: input.requestId,
  })
}
